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
    if (!identity) {
      identity = this.generateIdentity();
    }
    this.identity = identity;

    try {
      // 启动Waku节点
      this.node = await createLightNode();
      await this.node.start();

      // 连接到公共Waku节点
      const bootstrapNodes = [
        '/dns4/node-01.do-ams3.wakuv2.test.statusim.net/tcp/443/wss/p2p/16Uiu2HAmPLe7Mzm8TsYUubgCAW1aJoeFScxrLj8ppHFivPo97bUZ',
        '/dns4/node-02.do-ams3.wakuv2.test.statusim.net/tcp/443/wss/p2p/16Uiu2HAmPLe7Mzm8TsYUubgCAW1aJoeFScxrLj8ppHFivPo97bUZ',
      ];

      let connected = false;
      for (const node of bootstrapNodes) {
        try {
          await this.node.dial(node);
          console.log(`Connected to bootstrap node: ${node}`);
          connected = true;
          break;
        } catch (error) {
          console.warn(`Failed to connect to bootstrap node: ${node}`, error);
        }
      }

      if (!connected) {
        console.warn('Could not connect to any bootstrap node. Running in offline mode.');
      } else {
        // 等待远程对等节点
        await waitForRemotePeer(this.node, [
          Protocols.LightPush,
          Protocols.Filter,
          this.options.storeMessages ? Protocols.Store : undefined,
        ].filter(Boolean) as Protocols[]);
        console.log('Connected to Waku network');
      }
    } catch (error) {
      console.error('Failed to initialize Waku node:', error);
      console.warn('Running in offline mode');
    }

    return identity;
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
    // 直接使用会话ID生成加密密钥，确保同一会话的所有用户使用相同密钥
    // 实际项目中应该使用更安全的密钥协商机制，如Diffie-Hellman密钥交换
    const hash = keccak256(
      toUtf8Bytes(conversationId)
    );
    return hash.slice(0, 32); // 使用前32字节作为密钥
  }

  private encryptMessage(plaintext: string, key: string): Uint8Array {
    // 使用会话密钥加密消息（简化实现，实际应该使用更安全的加密方案）
    const textEncoder = new TextEncoder();
    const encoder = new TextEncoder();
    const keyBytes = encoder.encode(key);

    // 这里使用简单的XOR加密作为演示，实际项目中应该使用AES-256-GCM等更安全的加密方案
    const plaintextBytes = textEncoder.encode(plaintext);
    const ciphertextBytes = new Uint8Array(plaintextBytes.length);

    for (let i = 0; i < plaintextBytes.length; i++) {
      ciphertextBytes[i] = plaintextBytes[i] ^ keyBytes[i % keyBytes.length];
    }

    return ciphertextBytes;
  }

  private decryptMessage(ciphertext: Uint8Array, key: string): string {
    // 使用会话密钥解密消息（简化实现，实际应该使用更安全的加密方案）
    const textDecoder = new TextDecoder();
    const encoder = new TextEncoder();
    const keyBytes = encoder.encode(key);

    // 这里使用简单的XOR解密作为演示，实际项目中应该使用AES-256-GCM等更安全的加密方案
    const plaintextBytes = new Uint8Array(ciphertext.length);

    for (let i = 0; i < ciphertext.length; i++) {
      plaintextBytes[i] = ciphertext[i] ^ keyBytes[i % keyBytes.length];
    }

    return textDecoder.decode(plaintextBytes);
  }

  private generateConversationId(participants: string[], type: 'direct' | 'group'): string {
    if (type === 'direct') {
      return participants.sort().join('_');
    } else {
      return `group_${uuidv4()}`;
    }
  }

  async sendMessage(conversationId: string, content: string): Promise<string> {
    if (!this.identity) {
      throw new Error('SDK not initialized');
    }

    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

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

    // 加密消息
    const plaintext = JSON.stringify(message);
    const encryptedPayload = this.encryptMessage(plaintext, encryptionKey);

    // 本地存储消息
    this.storeMessage(message);
    this.notifyMessageHandlers(message);

    // 如果有网络连接，发送到Waku网络
    if (this.node) {
      try {
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

        await this.node.lightPush.send(encoder, wakuMessage);
        console.log(`Message sent to Waku network: ${message.id}`);
      } catch (error) {
        console.error('Failed to send message to Waku network:', error);
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
        };

        await this.node.lightPush.send(encoder, wakuMessage);
        console.log(`Tombstone message sent to Waku network: ${tombstoneMessage.id}`);
      } catch (error) {
        console.error('Failed to send tombstone message to Waku network:', error);
      }
    }

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
          // 获取会话加密密钥
          let encryptionKey = this.encryptionKeys.get(conversationId);
          // 如果加密密钥不存在，说明这是一个新会话，自动生成密钥
          if (!encryptionKey) {
            encryptionKey = this.generateEncryptionKey(conversationId);
            this.encryptionKeys.set(conversationId, encryptionKey);
          }

          // 解密消息
          const decryptedPayload = this.decryptMessage(wakuMessage.payload, encryptionKey);
          const message = JSON.parse(decryptedPayload) as Message;

          // 如果会话不存在，自动创建会话
          if (!this.conversations.has(conversationId)) {
            // 从消息中获取参与者信息（消息发送者 + 当前用户）
            const participants = [...new Set([message.sender, this.identity!.peerId])];
            const conversation: Conversation = {
              id: conversationId,
              type: 'direct', // 默认作为直接聊天处理
              participants,
              name: `Chat with ${message.sender.slice(0, 6)}...`
            };
            this.conversations.set(conversationId, conversation);
            console.log(`Auto-created conversation ${conversationId} for message from ${message.sender}`);
          }

          // 存储并处理消息
          this.storeMessage(message);
          this.notifyMessageHandlers(message);
        } catch (error) {
          console.error('Failed to process message:', error);
        }
      });

      // 标记会话为已订阅
      this.subscribedConversations.add(conversationId);
      console.log(`Subscribed to Waku content topic: ${contentTopic}`);
    } catch (error) {
      console.error(`Failed to subscribe to conversation ${conversationId}:`, error);
    }
  }

  private getContentTopic(conversationId: string): string {
    return `/chat/${conversationId}/proto`;
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

  async fetchHistory(conversationId: string): Promise<Message[]> {
    if (!this.identity) {
      throw new Error('SDK not initialized');
    }

    // 离线模式：返回本地存储的消息
    console.log('Fetching history in offline mode');
    return this.getMessages(conversationId);
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