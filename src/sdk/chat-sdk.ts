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

  constructor(options: ChatOptions = {}) {
    this.options = options;
  }

  async init(identity?: UserIdentity): Promise<UserIdentity> {
    if (!identity) {
      identity = this.generateIdentity();
    }
    this.identity = identity;

    this.node = await createLightNode();

    await this.node.start();

    // 连接到公共Waku节点
    const bootstrapNodes = [
      '/dns4/node-01.do-ams3.wakuv2.test.statusim.net/tcp/443/wss/p2p/16Uiu2HAmPLe7Mzm8TsYUubgCAW1aJoeFScxrLj8ppHFivPo97bUZ',
      '/dns4/node-02.do-ams3.wakuv2.test.statusim.net/tcp/443/wss/p2p/16Uiu2HAmPLe7Mzm8TsYUubgCAW1aJoeFScxrLj8ppHFivPo97bUZ',
    ];

    for (const node of bootstrapNodes) {
      try {
        await this.node.dial(node);
        console.log(`Connected to bootstrap node: ${node}`);
      } catch (error) {
        console.error(`Failed to connect to bootstrap node: ${node}`, error);
      }
    }

    await waitForRemotePeer(this.node, [
      Protocols.LightPush,
      Protocols.Filter,
      this.options.storeMessages ? Protocols.Store : undefined,
    ].filter(Boolean) as Protocols[]);

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

    const allParticipants = [...new Set([this.identity.peerId, ...participants])];
    const conversationId = this.generateConversationId(allParticipants, type);

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
    // 使用会话ID和用户私钥生成加密密钥
    const hash = keccak256(
      toUtf8Bytes(`${conversationId}-${this.identity.privateKey}`)
    );
    return hash.slice(0, 32); // 使用前32字节作为密钥
  }

  private generateConversationId(participants: string[], type: 'direct' | 'group'): string {
    if (type === 'direct') {
      return participants.sort().join('_');
    } else {
      return `group_${uuidv4()}`;
    }
  }

  async sendMessage(conversationId: string, content: string): Promise<string> {
    if (!this.node || !this.identity) {
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

    const contentTopic = this.getContentTopic(conversationId);
    const routingInfo = this.getRoutingInfo();
    const encoder = createEncoder({ contentTopic, routingInfo });

    const wakuMessage = {
      payload: new TextEncoder().encode(JSON.stringify(message)),
      contentTopic,
      ephemeral: false,
    };

    await this.node.lightPush.send(encoder, wakuMessage);

    this.storeMessage(message);
    this.notifyMessageHandlers(message);

    return message.id;
  }

  async revokeMessage(conversationId: string, messageId: string): Promise<string> {
    if (!this.node || !this.identity) {
      throw new Error('SDK not initialized');
    }

    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    const tombstoneMessage: Message = {
      id: uuidv4(),
      conversationId,
      sender: this.identity.peerId,
      content: '',
      timestamp: Date.now(),
      type: 'tombstone',
      tombstoneFor: messageId,
    };

    const contentTopic = this.getContentTopic(conversationId);
    const routingInfo = this.getRoutingInfo();
    const encoder = createEncoder({ contentTopic, routingInfo });

    const wakuMessage = {
      payload: new TextEncoder().encode(JSON.stringify(tombstoneMessage)),
      contentTopic,
    };

    await this.node.lightPush.send(encoder, wakuMessage);

    this.storeMessage(tombstoneMessage);
    this.notifyMessageHandlers(tombstoneMessage);

    return tombstoneMessage.id;
  }

  async subscribe(conversationId: string, handler: MessageHandler): Promise<void> {
    if (!this.messageHandlers.has(conversationId)) {
      this.messageHandlers.set(conversationId, []);
    }
    this.messageHandlers.get(conversationId)?.push(handler);

    await this.subscribeToConversation(conversationId);
  }

  private async subscribeToConversation(conversationId: string): Promise<void> {
    if (!this.node) return;

    const contentTopic = this.getContentTopic(conversationId);
    const routingInfo = this.getRoutingInfo();
    const decoder = createDecoder(contentTopic, routingInfo);

    await this.node.filter.subscribe([decoder], async (wakuMessage) => {
      if (!wakuMessage.payload) return;

      try {
        const message = JSON.parse(new TextDecoder().decode(wakuMessage.payload)) as Message;
        this.storeMessage(message);
        this.notifyMessageHandlers(message);
      } catch (error) {
        console.error('Failed to parse message:', error);
      }
    });
  }

  private getContentTopic(conversationId: string): string {
    return `/chat/${conversationId}/proto`;
  }

  private getRoutingInfo(): any {
    return {
      pubsubTopic: '/waku/2/default-waku/proto'
    };
  }

  private storeMessage(message: Message): void {
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

  async close(): Promise<void> {
    if (this.node) {
      await this.node.stop();
      this.node = null;
    }
  }
}

export default ChatSDK;