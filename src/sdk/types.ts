export interface UserIdentity {
  peerId: string;
  privateKey: string;
  publicKey: string;
}

export interface Conversation {
  id: string;
  type: 'direct' | 'group';
  participants: string[]; // 参与者的peerId
  name?: string; // 群聊名称
}

export interface Message {
  id: string;
  conversationId: string;
  sender: string; // 发送者的peerId
  content: string;
  timestamp: number;
  type: 'text' | 'tombstone';
  tombstoneFor?: string; // 被撤回的消息ID
}

export interface ChatOptions {
  storeMessages?: boolean;
  useLightNode?: boolean;
}

export type MessageHandler = (message: Message) => void;