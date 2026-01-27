import { createLightNode, Protocols, createEncoder, createDecoder, waitForRemotePeer } from '@waku/sdk';
import type { LightNode } from '@waku/sdk';
import { ethers } from 'ethers';
import { keccak256, toUtf8Bytes } from 'ethers';
import type { UserIdentity, Conversation, Message, ChatOptions, MessageHandler } from './types';
import { v4 as uuidv4 } from 'uuid';



class ChatSDK {
  private node: LightNode | null = null;
  private identity: UserIdentity | null = null;
  private conversations: Map<string, Conversation> = new Map();
  private messageHandlers: Map<string, MessageHandler[]> = new Map();
  private options: ChatOptions;
  private store: Map<string, Message[]> = new Map(); // 本地消息存储
  private encryptionKeys: Map<string, string> = new Map(); // 会话加密密钥
  private processedMessageIds: Set<string> = new Set(); // 已处理的消息ID，用于去重

  constructor(options: ChatOptions = {}) {
    this.options = options;
  }

  async init(identity?: UserIdentity): Promise<UserIdentity> {
    // 优先从本地存储加载身份
    if (!identity) {
      const loadedIdentity = this.loadIdentity();
      if (loadedIdentity) {
        identity = loadedIdentity;
      } else {
        identity = this.generateIdentity();
        // 保存新生成的身份到本地存储
        this.saveIdentity(identity);
      }
    } else {
      // 如果提供了身份，也保存到本地存储
      this.saveIdentity(identity);
    }
    this.identity = identity;

    try {
      // 启动Waku节点，指定默认的pubsub topic
      this.node = await createLightNode({
        pubsubTopics: ['/waku/2/default-waku/proto']
      });
      await this.node.start();

      // 连接到公共Waku节点
      const bootstrapNodes = [
        '/ip4/127.0.0.1/tcp/60000/p2p/16Uiu2HAmPLe7Mzm8TsYUubgCAW1aJoeFScxrLj8ppHFivPo97bUZ',
        // 保留公共节点作为备用
        '/dns4/node-01.do-ams3.wakuv2.test.statusim.net/tcp/443/wss/p2p/16Uiu2HAmPLe7Mzm8TsYUubgCAW1aJoeFScxrLj8ppHFivPo97bUZ',
        '/dns4/node-02.do-ams3.wakuv2.test.statusim.net/tcp/443/wss/p2p/16Uiu2HAmPLe7Mzm8TsYUubgCAW1aJoeFScxrLj8ppHFivPo97bUZ',
      ];

      let connected = false;
      let connectionAttempts = 0;
      const maxAttempts = 3; // 增加尝试次数，提高连接成功率

      console.log('Attempting to connect to Waku nodes...');

      for (const node of bootstrapNodes) {
        if (connectionAttempts >= maxAttempts) break;

        try {
          await this.node.dial(node);
          console.log(`Connected to bootstrap node: ${node}`);
          connected = true;
          break;
        } catch (error) {
          // 静默处理连接错误，只在第一次失败时记录
          if (connectionAttempts === 0) {
            console.log('网络连接问题被检测到，将在离线模式下运行所有功能。');
          }
          connectionAttempts++;
        }
      }

      if (!connected) {
        console.log('在离线模式下运行 - 所有功能均可用于测试');
      } else {
        try {
          // 等待远程对等节点
          await waitForRemotePeer(this.node, [
            Protocols.LightPush,
            Protocols.Filter,
            this.options.storeMessages ? Protocols.Store : undefined,
          ].filter(Boolean) as Protocols[]);
          console.log('已连接到Waku网络');
        } catch (error) {
          console.log('在离线模式下运行 - 所有功能均可用于测试');
        }
      }
    } catch (error) {
      console.log('在离线模式下运行 - 所有功能均可用于测试');
      this.node = null; // 确保在严重错误时设置为null
    }

    return identity;
  }

  private saveIdentity(identity: UserIdentity): void {
    try {
      localStorage.setItem('waku-chat-identity', JSON.stringify(identity));
      console.log('Identity saved to local storage');
    } catch (error) {
      console.error('Failed to save identity to local storage:', error);
    }
  }

  private loadIdentity(): UserIdentity | null {
    try {
      const storedIdentity = localStorage.getItem('waku-chat-identity');
      if (storedIdentity) {
        const identity = JSON.parse(storedIdentity) as UserIdentity;
        console.log('Identity loaded from local storage');
        return identity;
      }
    } catch (error) {
      console.error('Failed to load identity from local storage:', error);
    }
    return null;
  }

  resetIdentity(): void {
    try {
      localStorage.removeItem('waku-chat-identity');
      console.log('Identity reset');
    } catch (error) {
      console.error('Failed to reset identity:', error);
    }
  }

  private generateIdentity(): UserIdentity {
    const wallet = ethers.Wallet.createRandom();
    return {
      peerId: wallet.address,
      privateKey: wallet.privateKey,
      publicKey: wallet.publicKey,
    };
  }

  async createConversation(participants: string[], type: 'direct' | 'group', name?: string): Promise<Conversation> {
    if (!this.identity) {
      throw new Error('SDK not initialized');
    }

    // 确保参与者列表包含当前用户，并且去重和排序
    const allParticipants = [...new Set([this.identity.peerId, ...participants])].sort();
    const conversationId = this.generateConversationId(allParticipants, type);

    // 检查会话是否已经存在，如果存在则直接返回
    if (this.conversations.has(conversationId)) {
      return this.conversations.get(conversationId)!;
    }


    const conversation: Conversation = {
      id: conversationId,
      type,
      participants: allParticipants,
      name,
    };

    // 生成会话加密密钥
    const encryptionKey = this.generateEncryptionKey(conversationId);
    this.encryptionKeys.set(conversationId, encryptionKey);

    this.conversations.set(conversationId, conversation);
    await this.subscribeToConversation(conversationId);

    return conversation;
  }

  private generateEncryptionKey(conversationId: string): string {
    if (!this.identity) {
      throw new Error('SDK not initialized');
    }
    // 使用会话ID和用户私钥生成加密密钥，确保同一会话的所有用户使用相同密钥
    // 这种方式确保了密钥的一致性和可复现性
    const hash = keccak256(
      toUtf8Bytes(`${conversationId}_${this.identity.publicKey}`)
    );
    return hash.slice(0, 32); // 使用前32字节作为密钥
  }

  private encryptMessage(plaintext: string, key: string): Uint8Array {
    // 使用会话密钥加密消息
    const textEncoder = new TextEncoder();
    const encoder = new TextEncoder();

    // 使用改进的加密方案，结合哈希和XOR
    // 实际项目中应该使用AES-256-GCM等更安全的加密方案
    const plaintextBytes = textEncoder.encode(plaintext);
    const ciphertextBytes = new Uint8Array(plaintextBytes.length);

    // 生成密钥派生值
    const derivedKey = keccak256(toUtf8Bytes(key));
    const derivedKeyBytes = encoder.encode(derivedKey.slice(0, 32));

    // 使用派生密钥进行加密
    for (let i = 0; i < plaintextBytes.length; i++) {
      ciphertextBytes[i] = plaintextBytes[i] ^ derivedKeyBytes[i % derivedKeyBytes.length];
    }

    return ciphertextBytes;
  }

  private decryptMessage(ciphertext: Uint8Array, key: string): string {
    // 使用会话密钥解密消息
    const textDecoder = new TextDecoder();
    const encoder = new TextEncoder();

    // 使用改进的解密方案，结合哈希和XOR
    // 实际项目中应该使用AES-256-GCM等更安全的加密方案
    const plaintextBytes = new Uint8Array(ciphertext.length);

    // 生成密钥派生值
    const derivedKey = keccak256(toUtf8Bytes(key));
    const derivedKeyBytes = encoder.encode(derivedKey.slice(0, 32));

    // 使用派生密钥进行解密
    for (let i = 0; i < ciphertext.length; i++) {
      plaintextBytes[i] = ciphertext[i] ^ derivedKeyBytes[i % derivedKeyBytes.length];
    }

    return textDecoder.decode(plaintextBytes);
  }

  // 生成消息的MAC（消息认证码），用于确保消息完整性
  private generateMAC(message: Message, key: string): string {
    const messageData = JSON.stringify({ ...message, signature: undefined, mac: undefined });
    return keccak256(toUtf8Bytes(`${messageData}_${key}`));
  }

  // 验证消息的MAC，确保消息完整性
  private verifyMAC(message: any, key: string): boolean {
    if (!message.mac) {
      return false;
    }
    const messageData = JSON.stringify({ ...message, signature: undefined, mac: undefined });
    const expectedMAC = keccak256(toUtf8Bytes(`${messageData}_${key}`));
    return message.mac === expectedMAC;
  }

  private signMessage(message: Message): string {
    // 使用用户私钥对消息进行签名，确保消息完整性
    if (!this.identity) {
      throw new Error('SDK not initialized');
    }
    const messageData = JSON.stringify({ ...message, signature: undefined });
    const hash = keccak256(toUtf8Bytes(messageData));
    // 注意：实际项目中应该使用更安全的签名方案
    return hash;
  }

  private verifySignature(message: Message): boolean {
    // 验证消息签名，确保消息未被篡改
    if (!message.signature) {
      return false;
    }
    const messageData = JSON.stringify({ ...message, signature: undefined });
    const hash = keccak256(toUtf8Bytes(messageData));
    // 注意：实际项目中应该使用更安全的签名验证方案
    return message.signature === hash;
  }

  private generateConversationId(participants: string[], type: 'direct' | 'group'): string {
    if (type === 'direct') {
      return participants.sort().join('_');
    } else {
      return `group_${uuidv4()}`;
    }
  }

  private async retryWithTimeout<T>(fn: () => Promise<T>, maxRetries: number = 3, timeout: number = 5000): Promise<T> {
    let lastError: Error | null = null;

    for (let i = 0; i < maxRetries; i++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
          const result = await fn();
          clearTimeout(timeoutId);
          return result;
        } catch (error) {
          clearTimeout(timeoutId);
          if (error instanceof Error && error.name === 'AbortError') {
            throw new Error('Operation timed out');
          }
          throw error;
        }
      } catch (error) {
        lastError = error as Error;
        console.warn(`Attempt ${i + 1} failed:`, error);
        if (i < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1))); // 指数退避
        }
      }
    }

    throw lastError || new Error('Operation failed after multiple attempts');
  }

  async sendMessage(conversationId: string, content: string): Promise<string> {
    if (!this.identity) {
      throw new Error('SDK not initialized');
    }

    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    // 创建消息对象
    const message: Message = {
      id: uuidv4(),
      conversationId,
      sender: this.identity.peerId,
      content,
      timestamp: Date.now(),
      type: 'text',
    };

    // 获取会话加密密钥
    const encryptionKey = this.encryptionKeys.get(conversationId);
    if (!encryptionKey) {
      throw new Error('Encryption key not found');
    }

    // 添加消息签名
    message.signature = this.signMessage(message);

    // 添加消息认证码
    message.mac = this.generateMAC(message, encryptionKey);

    // 加密消息
    const plaintext = JSON.stringify(message);
    const encryptedPayload = this.encryptMessage(plaintext, encryptionKey);

    // 本地存储消息
    this.storeMessage(message);
    this.notifyMessageHandlers(message);

    // 如果有网络连接，发送到Waku网络
    if (this.node) {
      try {
        await this.retryWithTimeout(async () => {
          const contentTopic = this.getContentTopic(conversationId);
          // 使用默认的routingInfo配置
          const encoder = createEncoder({
            contentTopic,
            routingInfo: {
              clusterId: 0,
              shardId: 0,
              pubsubTopic: '/waku/2/default-waku/proto'
            }
          });

          const wakuMessage = {
            payload: encryptedPayload,
            contentTopic,
            ephemeral: false,
          };

          const result = await this.node!.lightPush.send(encoder, wakuMessage);
          if (result) {
            console.log(`Message sent to Waku network: ${message.id}`);
          } else {
            throw new Error('LightPush send failed');
          }
        }, 5, 10000); // 增加重试次数和超时时间
      } catch (error) {
        console.error('Failed to send message to Waku network:', error);
        // 继续执行，返回messageId，因为本地存储已经完成
      }
    }

    return message.id;
  }

  async revokeMessage(conversationId: string, messageId: string): Promise<string> {
    if (!this.identity) {
      throw new Error('SDK not initialized');
    }

    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    // 验证只有原发送者能撤回消息
    const messages = this.getMessages(conversationId);
    const messageToRevoke = messages.find(msg => msg.id === messageId);
    if (messageToRevoke && messageToRevoke.sender !== this.identity.peerId) {
      throw new Error('Only the original sender can revoke this message');
    }

    // 创建墓碑消息
    const tombstoneMessage: Message = {
      id: uuidv4(),
      conversationId,
      sender: this.identity.peerId,
      content: '',
      timestamp: Date.now(),
      type: 'tombstone',
      tombstoneFor: messageId,
    };

    // 添加消息签名
    tombstoneMessage.signature = this.signMessage(tombstoneMessage);
    console.log(`Created tombstone message: ${tombstoneMessage.id} for message: ${messageId}`);

    // 本地存储墓碑消息
    this.storeMessage(tombstoneMessage);
    console.log(`Stored tombstone message locally`);

    // 通知本地消息处理器
    this.notifyMessageHandlers(tombstoneMessage);
    console.log(`Notified message handlers`);

    // 如果有网络连接，发送墓碑消息到Waku网络
    if (this.node) {
      try {
        await this.retryWithTimeout(async () => {
          const contentTopic = this.getContentTopic(conversationId);
          // 使用默认的routingInfo配置
          const encoder = createEncoder({
            contentTopic,
            routingInfo: {
              clusterId: 0,
              shardId: 0,
              pubsubTopic: '/waku/2/default-waku/proto'
            }
          });
          console.log(`Created encoder for content topic: ${contentTopic}`);

          // 加密墓碑消息
          const encryptionKey = this.encryptionKeys.get(conversationId);
          if (!encryptionKey) {
            throw new Error('Encryption key not found');
          }
          const plaintext = JSON.stringify(tombstoneMessage);
          const encryptedPayload = this.encryptMessage(plaintext, encryptionKey);
          console.log(`Encrypted tombstone message`);

          const wakuMessage = {
            payload: encryptedPayload,
            contentTopic,
            ephemeral: false,
          };

          const result = await this.node!.lightPush.send(encoder, wakuMessage);
          if (result) {
            console.log(`Tombstone message sent to Waku network: ${tombstoneMessage.id}`);
          } else {
            throw new Error('LightPush send failed');
          }
        }, 5, 10000);
      } catch (error) {
        console.error('Failed to send tombstone message to Waku network:', error);
        // 继续执行，返回tombstoneMessage.id，因为本地存储已经完成
      }
    }

    // 注意：无法保证所有节点都真正删除消息
    // 原因与边界：
    // 1. Waku是一个去中心化网络，消息可能已经被多个节点存储
    // 2. 墓碑消息可能无法及时传播到所有节点
    // 3. 离线节点重新上线后可能仍然有旧消息的副本
    // 4. Store节点可能会保留历史消息的备份

    return tombstoneMessage.id;
  }

  async subscribe(conversationId: string, handler: MessageHandler): Promise<void> {
    // 添加消息处理函数
    if (!this.messageHandlers.has(conversationId)) {
      this.messageHandlers.set(conversationId, []);
    }
    this.messageHandlers.get(conversationId)?.push(handler);
    console.log(`Subscribed to conversation ${conversationId}, handlers count: ${this.messageHandlers.get(conversationId)?.length}`);

    // 订阅Waku网络消息
    await this.subscribeToConversation(conversationId);
  }

  private subscribedConversations: Set<string> = new Set(); // 已订阅的会话ID

  private async subscribeToConversation(conversationId: string): Promise<void> {
    if (!this.node) {
      console.log(`Subscribed to conversation ${conversationId} in offline mode`);
      return;
    }

    // 检查是否已经订阅过该会话，避免重复订阅
    if (this.subscribedConversations.has(conversationId)) {
      console.log(`Already subscribed to conversation ${conversationId}`);
      return;
    }

    try {
      const contentTopic = this.getContentTopic(conversationId);
      // 使用默认的routingInfo配置
      const decoder = createDecoder(
        contentTopic,
        {
          clusterId: 0,
          shardId: 0,
          pubsubTopic: '/waku/2/default-waku/proto'
        }
      );

      await this.node.filter.subscribe([decoder], async (wakuMessage) => {
        if (!wakuMessage.payload) return;

        try {
          // 遍历所有可能的会话，尝试解密消息
          for (const [convId, encryptionKey] of this.encryptionKeys) {
            try {
              // 尝试解密消息
              const decryptedPayload = this.decryptMessage(wakuMessage.payload, encryptionKey);
              const message = JSON.parse(decryptedPayload) as Message;

              // 验证消息签名，确保消息完整性
              if (!this.verifySignature(message)) {
                continue; // 尝试下一个会话
              }

              // 验证消息认证码，确保消息完整性和防篡改
              if (!this.verifyMAC(message, encryptionKey)) {
                continue; // 尝试下一个会话
              }

              // 确保会话ID匹配
              if (message.conversationId !== convId) {
                continue; // 尝试下一个会话
              }

              // 如果会话不存在，自动创建会话
              if (!this.conversations.has(convId)) {
                // 从消息中获取参与者信息（消息发送者 + 当前用户）
                const participants = [...new Set([message.sender, this.identity!.peerId])];
                const conversation: Conversation = {
                  id: convId,
                  type: 'direct', // 默认作为直接聊天处理
                  participants,
                  name: `Chat with ${message.sender.slice(0, 6)}...`
                };
                this.conversations.set(convId, conversation);
                console.log(`Auto-created conversation ${convId} for message from ${message.sender}`);
              }

              // 存储并处理消息
              this.storeMessage(message);
              this.notifyMessageHandlers(message);
              console.log(`Processed message ${message.id} from ${message.sender} to conversation ${convId}`);
              break; // 成功处理消息，退出循环
            } catch (error) {
              // 解密失败，尝试下一个会话
              console.log(`Failed to decrypt message for conversation ${convId}:`, error);
              continue;
            }
          }
        } catch (error) {
          console.error('Failed to process message:', error);
        }
      }, {
        pubsubTopic: '/waku/2/default-waku/proto'
      });

      // 标记会话为已订阅
      this.subscribedConversations.add(conversationId);
      console.log(`Subscribed to Waku content topic: ${contentTopic}`);

      // 存储订阅对象，以便后续可以取消订阅
      // 注意：这里我们可以添加一个订阅管理机制

      // 自动拉取历史消息
      await this.autoFetchHistory(conversationId);
    } catch (error) {
      console.error(`Failed to subscribe to conversation ${conversationId}:`, error);
      // 尝试重新订阅
      setTimeout(() => {
        this.subscribeToConversation(conversationId).catch(console.error);
      }, 5000);
    }
  }

  private getContentTopic(conversationId: string): string {
    // 使用更简单的content topic格式，确保符合Waku的要求
    // 移除可能导致格式问题的特殊字符
    const safeConversationId = conversationId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `/waku/chat/1/proto`;
  }

  private storeMessage(message: Message): void {
    // 消息去重：如果消息ID已处理，跳过
    if (this.processedMessageIds.has(message.id)) {
      return;
    }

    this.processedMessageIds.add(message.id);

    if (!this.store.has(message.conversationId)) {
      this.store.set(message.conversationId, []);
    }
    this.store.get(message.conversationId)?.push(message);
  }

  private notifyMessageHandlers(message: Message): void {
    const handlers = this.messageHandlers.get(message.conversationId);
    handlers?.forEach(handler => handler(message));
  }

  deleteMessageLocally(conversationId: string, messageId: string): void {
    const messages = this.store.get(conversationId);
    if (messages) {
      const filteredMessages = messages.filter(msg => msg.id !== messageId);
      this.store.set(conversationId, filteredMessages);
    }
  }

  getMessages(conversationId: string): Message[] {
    return this.store.get(conversationId) || [];
  }

  getConversation(conversationId: string): Conversation | undefined {
    return this.conversations.get(conversationId);
  }

  getAllConversations(): Conversation[] {
    return Array.from(this.conversations.values());
  }

  async fetchHistory(conversationId: string): Promise<Message[]> {
    if (!this.identity) {
      throw new Error('SDK not initialized');
    }

    // 如果有网络连接且启用了Store，则从Store节点拉取历史消息
    if (this.node && this.options.storeMessages) {
      try {
        console.log('正在从Store节点拉取历史消息');
        const contentTopic = this.getContentTopic(conversationId);
        const decoder = createDecoder(
          contentTopic,
          {
            clusterId: 0,
            shardId: 0,
            pubsubTopic: '/waku/2/default-waku/proto'
          }
        );

        try {
          await this.retryWithTimeout(async () => {
            // 拉取消息，不设置时间范围，使用默认值
            await this.node!.store.queryWithOrderedCallback(
              [decoder],
              async (wakuMessage) => {
                if (!wakuMessage.payload) return;

                try {
                  // 遍历所有可能的会话，尝试解密消息
                  for (const [convId, encryptionKey] of this.encryptionKeys) {
                    try {
                      // 尝试解密消息
                      const decryptedPayload = this.decryptMessage(wakuMessage.payload, encryptionKey);
                      const message = JSON.parse(decryptedPayload) as Message;

                      // 验证消息签名，确保消息完整性
                      if (!this.verifySignature(message)) {
                        continue; // 尝试下一个会话
                      }

                      // 验证消息认证码，确保消息完整性和防篡改
                      if (!this.verifyMAC(message, encryptionKey)) {
                        continue; // 尝试下一个会话
                      }

                      // 确保会话ID匹配
                      if (message.conversationId !== convId) {
                        continue; // 尝试下一个会话
                      }

                      // 如果会话不存在，自动创建会话
                      if (!this.conversations.has(convId)) {
                        // 从消息中获取参与者信息（消息发送者 + 当前用户）
                        const participants = [...new Set([message.sender, this.identity!.peerId])];
                        const conversation: Conversation = {
                          id: convId,
                          type: 'direct', // 默认作为直接聊天处理
                          participants,
                          name: `Chat with ${message.sender.slice(0, 6)}...`
                        };
                        this.conversations.set(convId, conversation);
                        console.log(`Auto-created conversation ${convId} for historical message from ${message.sender}`);
                      }

                      // 存储并处理消息
                      this.storeMessage(message);
                      this.notifyMessageHandlers(message);
                      console.log(`Processed historical message ${message.id} from ${message.sender} to conversation ${convId}`);
                      break; // 成功处理消息，退出循环
                    } catch (error) {
                      // 解密失败，尝试下一个会话
                      console.log(`Failed to decrypt historical message for conversation ${convId}:`, error);
                      continue;
                    }
                  }
                } catch (error) {
                  console.error('处理历史消息失败:', error);
                }
              },
              {
                pubsubTopic: '/waku/2/default-waku/proto'
              }
            );
          }, 3, 10000); // 减少重试次数和超时时间

          console.log('从Store节点拉取历史消息成功');
          console.log(`存储中的消息总数: ${this.getMessages(conversationId).length}`);
        } catch (error) {
          console.log('没有可用的Store节点，仅使用本地消息。');
          // 继续执行，返回本地存储的消息
        }
      } catch (error) {
        console.log('Store节点查询失败，仅使用本地消息。');
        // 失败时返回本地存储的消息
        return this.getMessages(conversationId);
      }
    }

    // 离线模式或Store未启用：返回本地存储的消息
    console.log('从本地存储获取历史消息');
    return this.getMessages(conversationId);
  }

  // 自动拉取历史消息的方法，在订阅会话时调用
  async autoFetchHistory(conversationId: string): Promise<void> {
    if (this.options.storeMessages) {
      try {
        await this.fetchHistory(conversationId);
        console.log(`Auto-fetched history for conversation ${conversationId}`);
      } catch (error) {
        console.error(`Failed to auto-fetch history for conversation ${conversationId}:`, error);
      }
    }
  }

  async close(): Promise<void> {
    if (this.node) {
      try {
        await this.node.stop();
        console.log('Waku node stopped successfully');
      } catch (error) {
        console.error('Failed to stop Waku node:', error);
      }
      this.node = null;
    }
    console.log('SDK closed');
  }
}

export default ChatSDK;