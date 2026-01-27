import { useState, useEffect } from 'react';
import './App.css';

// 类型定义
interface UserIdentity {
  peerId: string;
  privateKey: string;
  publicKey: string;
}

interface Conversation {
  id: string;
  type: 'direct' | 'group';
  participants: string[];
  name?: string;
}

interface Message {
  id: string;
  conversationId: string;
  sender: string;
  content: string;
  timestamp: number;
  type: 'text' | 'tombstone';
  tombstoneFor?: string;
  signature?: string;
  mac?: string;
  isRevoked?: boolean;
}

// 本地存储键名
const STORAGE_KEYS = {
  IDENTITY: 'waku-chat-identity',
  MESSAGES: 'waku-chat-messages',
  CONVERSATIONS: 'waku-chat-conversations'
};

// 模拟 ChatSDK 类，实现核心功能
class ChatSDK {
  private identity: UserIdentity | null = null;
  private conversations: Map<string, Conversation> = new Map();
  private messages: Map<string, Message[]> = new Map();
  private messageHandlers: Map<string, ((message: Message) => void)[]> = new Map();

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    // 从本地存储加载身份
    try {
      const storedIdentity = localStorage.getItem(STORAGE_KEYS.IDENTITY);
      if (storedIdentity) {
        this.identity = JSON.parse(storedIdentity);
      } else {
        this.generateIdentity();
      }
    } catch (error) {
      console.error('Failed to load identity from storage:', error);
      this.generateIdentity();
    }

    // 从本地存储加载消息
    try {
      const storedMessages = localStorage.getItem(STORAGE_KEYS.MESSAGES);
      if (storedMessages) {
        const messages = JSON.parse(storedMessages);
        messages.forEach((msg: Message) => {
          if (!this.messages.has(msg.conversationId)) {
            this.messages.set(msg.conversationId, []);
          }
          this.messages.get(msg.conversationId)?.push(msg);
        });
      }
    } catch (error) {
      console.error('Failed to load messages from storage:', error);
    }

    // 从本地存储加载对话
    try {
      const storedConversations = localStorage.getItem(STORAGE_KEYS.CONVERSATIONS);
      if (storedConversations) {
        const conversations = JSON.parse(storedConversations);
        conversations.forEach((convo: Conversation) => {
          this.conversations.set(convo.id, convo);
        });
      }
    } catch (error) {
      console.error('Failed to load conversations from storage:', error);
    }
  }

  private saveToStorage() {
    // 保存身份到本地存储
    try {
      localStorage.setItem(STORAGE_KEYS.IDENTITY, JSON.stringify(this.identity));
    } catch (error) {
      console.error('Failed to save identity to storage:', error);
    }

    // 保存消息到本地存储
    try {
      const allMessages: Message[] = [];
      this.messages.forEach(messages => {
        allMessages.push(...messages);
      });
      localStorage.setItem(STORAGE_KEYS.MESSAGES, JSON.stringify(allMessages));
    } catch (error) {
      console.error('Failed to save messages to storage:', error);
    }

    // 保存对话到本地存储
    try {
      const allConversations: Conversation[] = [];
      this.conversations.forEach(convo => {
        allConversations.push(convo);
      });
      localStorage.setItem(STORAGE_KEYS.CONVERSATIONS, JSON.stringify(allConversations));
    } catch (error) {
      console.error('Failed to save conversations to storage:', error);
    }
  }

  private generateIdentity() {
    // 生成随机身份
    this.identity = {
      peerId: `user_${Math.random().toString(36).substr(2, 9)}`,
      privateKey: `key_${Math.random().toString(36).substr(2, 9)}`,
      publicKey: `pub_${Math.random().toString(36).substr(2, 9)}`
    };
    this.saveToStorage();
  }

  async init(): Promise<UserIdentity> {
    console.log('SDK initialized with identity:', this.identity?.peerId);
    return this.identity!;
  }

  async createConversation(participants: string[], type: 'direct' | 'group'): Promise<Conversation> {
    // 确保参与者列表包含当前用户
    const allParticipants = [...new Set([this.identity!.peerId, ...participants])].sort();
    const conversationId = this.generateConversationId(allParticipants, type);

    // 检查会话是否已存在
    if (this.conversations.has(conversationId)) {
      return this.conversations.get(conversationId)!;
    }

    // 创建新会话
    const conversation: Conversation = {
      id: conversationId,
      type,
      participants: allParticipants,
      name: type === 'direct' ? `Chat with ${allParticipants.filter(p => p !== this.identity!.peerId).join(', ')}` : undefined
    };

    this.conversations.set(conversationId, conversation);
    this.messages.set(conversationId, []);
    this.saveToStorage();

    console.log('Conversation created:', conversation);
    return conversation;
  }

  private generateConversationId(participants: string[], type: 'direct' | 'group'): string {
    if (type === 'direct') {
      return participants.sort().join('_');
    } else {
      return `group_${Math.random().toString(36).substr(2, 9)}`;
    }
  }

  async sendMessage(conversationId: string, content: string): Promise<string> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    // 创建消息
    const message: Message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      conversationId,
      sender: this.identity!.peerId,
      content,
      timestamp: Date.now(),
      type: 'text'
    };

    // 存储消息
    const conversationMessages = this.messages.get(conversationId) || [];
    conversationMessages.push(message);
    this.messages.set(conversationId, conversationMessages);
    this.saveToStorage();

    // 通知消息处理程序
    const handlers = this.messageHandlers.get(conversationId) || [];
    handlers.forEach(handler => handler(message));

    console.log('Message sent:', message);
    return message.id;
  }

  async subscribe(conversationId: string, handler: (message: Message) => void): Promise<void> {
    if (!this.messageHandlers.has(conversationId)) {
      this.messageHandlers.set(conversationId, []);
    }
    this.messageHandlers.get(conversationId)?.push(handler);
    console.log('Subscribed to conversation:', conversationId);
  }

  getMessages(conversationId: string): Message[] {
    return this.messages.get(conversationId) || [];
  }

  getConversation(conversationId: string): Conversation | undefined {
    return this.conversations.get(conversationId);
  }

  getAllConversations(): Conversation[] {
    const conversations: Conversation[] = [];
    this.conversations.forEach(convo => conversations.push(convo));
    return conversations;
  }

  async revokeMessage(conversationId: string, messageId: string): Promise<string> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    // 创建墓碑消息
    const tombstoneMessage: Message = {
      id: `tombstone_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      conversationId,
      sender: this.identity!.peerId,
      content: '',
      timestamp: Date.now(),
      type: 'tombstone',
      tombstoneFor: messageId
    };

    // 存储墓碑消息
    const conversationMessages = this.messages.get(conversationId) || [];
    conversationMessages.push(tombstoneMessage);
    this.messages.set(conversationId, conversationMessages);
    this.saveToStorage();

    // 通知消息处理程序
    const handlers = this.messageHandlers.get(conversationId) || [];
    handlers.forEach(handler => handler(tombstoneMessage));

    console.log('Message revoked:', messageId);
    return tombstoneMessage.id;
  }

  deleteMessageLocally(conversationId: string, messageId: string): void {
    const conversationMessages = this.messages.get(conversationId) || [];
    const filteredMessages = conversationMessages.filter(msg => msg.id !== messageId);
    this.messages.set(conversationId, filteredMessages);
    this.saveToStorage();
    console.log('Message deleted locally:', messageId);
  }
}

function App() {
  const [sdk, setSdk] = useState<ChatSDK | null>(null);
  const [identity, setIdentity] = useState<string>('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [participantInput, setParticipantInput] = useState('');
  const [isInitializing, setIsInitializing] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<string>('Connected');

  useEffect(() => {
    initSDK();
    
    // 监听本地存储变化，实现跨标签页通信
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === STORAGE_KEYS.MESSAGES || event.key === STORAGE_KEYS.CONVERSATIONS) {
        loadMessagesAndConversations();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  useEffect(() => {
    // 定期检查本地存储变化，确保消息同步
    const interval = setInterval(() => {
      loadMessagesAndConversations();
    }, 1000);

    return () => clearInterval(interval);
  }, [currentConversation]);

  const initSDK = async () => {
    try {
      setIsInitializing(true);

      // 初始化SDK
      const chatSDK = new ChatSDK();
      const userIdentity = await chatSDK.init();
      setSdk(chatSDK);
      setIdentity(userIdentity.peerId);

      // 加载现有对话和消息
      loadMessagesAndConversations();

      console.log('SDK initialized successfully');
      console.log('Your ID:', userIdentity.peerId);

      // 显示提示
      alert(`Chat app initialized!\n\nYour ID: ${userIdentity.peerId}\n\nYou can now chat with other users by entering their ID.`);
    } catch (error) {
      console.error('Failed to initialize SDK:', error);
      setConnectionStatus('Error');
    } finally {
      setIsInitializing(false);
    }
  };

  const loadMessagesAndConversations = () => {
    if (!sdk) return;

    // 重新加载SDK数据
    const newSDK = new ChatSDK();
    setSdk(newSDK);

    // 加载所有对话
    const allConversations = newSDK.getAllConversations();
    setConversations(allConversations);

    // 如果有当前对话，加载其消息
    if (currentConversation) {
      const conversationMessages = newSDK.getMessages(currentConversation.id);
      setMessages(conversationMessages);
    }
  };

  const createConversation = async () => {
    if (!sdk || !participantInput.trim()) {
      alert('Please enter at least one participant ID');
      return;
    }

    try {
      const participants = participantInput.split(',').map(p => p.trim()).filter(p => p);
      if (participants.length === 0) {
        alert('Please enter valid participant IDs');
        return;
      }

      // 创建会话
      const conversation = await sdk.createConversation(participants, 'direct');
      console.log('Conversation created:', conversation);

      // 检查会话是否已经存在于UI中
      const existingConvo = conversations.find(c => c.id === conversation.id);
      if (!existingConvo) {
        // 订阅会话消息
        await sdk.subscribe(conversation.id, (message) => {
          console.log('Received message:', message);

          // 首先检查会话是否已经存在于UI中，如果不存在则自动创建
          setConversations(prevConversations => {
            const existingConvo = prevConversations.find(c => c.id === message.conversationId);
            if (!existingConvo) {
              const sdkConvo = sdk.getConversation(message.conversationId);
              if (sdkConvo) {
                console.log('Auto-creating conversation for received message:', message.conversationId);
                return [...prevConversations, sdkConvo];
              }
            }
            return prevConversations;
          });

          // 如果当前会话是消息所属的会话，更新消息列表
          if (currentConversation?.id === message.conversationId) {
            setMessages(prev => {
              if (!prev.some(msg => msg.id === message.id)) {
                return [...prev, message];
              }
              return prev;
            });
          }
        });

        // 更新状态
        setConversations(prev => [...prev, conversation]);
        setCurrentConversation(conversation);
        setMessages([]);
        setParticipantInput('');
        alert('Conversation created successfully!');
      } else {
        // 会话已存在，直接切换到该会话
        setCurrentConversation(existingConvo);
        setMessages(sdk.getMessages(existingConvo.id) || []);
        setParticipantInput('');
        alert('Conversation already exists!');
      }
    } catch (error) {
      console.error('Failed to create conversation:', error);
      alert('Failed to create conversation. Please try again.');
    }
  };

  const sendMessage = async () => {
    if (!sdk || !currentConversation || !messageInput.trim()) {
      return;
    }

    try {
      const messageId = await sdk.sendMessage(currentConversation.id, messageInput);
      setMessageInput('');

      // 手动添加消息到本地状态，确保UI立即更新
      const newMessage: Message = {
        id: messageId,
        conversationId: currentConversation.id,
        sender: identity,
        content: messageInput,
        timestamp: Date.now(),
        type: 'text'
      };

      setMessages(prev => [...prev, newMessage]);
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  const revokeMessage = async (messageId: string) => {
    if (!sdk || !currentConversation) return;

    try {
      await sdk.revokeMessage(currentConversation.id, messageId);

      // 添加墓碑消息到本地状态，确保UI立即更新
      const tombstoneMessage: Message = {
        id: `tombstone_${Date.now()}`,
        conversationId: currentConversation.id,
        sender: identity,
        content: '',
        timestamp: Date.now(),
        type: 'tombstone',
        tombstoneFor: messageId
      };

      setMessages(prev => [...prev, tombstoneMessage]);
    } catch (error) {
      console.error('Failed to revoke message:', error);
    }
  };

  const deleteMessage = (messageId: string) => {
    if (!sdk || !currentConversation) return;

    sdk.deleteMessageLocally(currentConversation.id, messageId);
    setMessages(prev => prev.filter(msg => msg.id !== messageId));
  };

  const getDisplayMessages = () => {
    if (!messages.length) return [];

    const tombstoneMap = new Map<string, boolean>();
    messages.forEach(msg => {
      if (msg.type === 'tombstone' && msg.tombstoneFor) {
        tombstoneMap.set(msg.tombstoneFor, true);
      }
    });

    return messages
      .filter(msg => msg.type !== 'tombstone')
      .map(msg => {
        if (tombstoneMap.has(msg.id)) {
          return {
            ...msg,
            content: '[Message has been revoked]',
            isRevoked: true
          };
        }
        return msg;
      });
  };

  if (isInitializing) {
    return <div className="app">Initializing SDK...</div>;
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Mini Encrypted Chat</h1>
        <div className="header-info">
          <div className="identity">Your ID: {identity}</div>
          <div className={`connection-status ${connectionStatus === 'Connected' ? 'connected' : 'error'}`}>
            {connectionStatus}
          </div>
        </div>
      </header>

      <div className="main">
        <div className="sidebar">
          <h2>Conversations</h2>
          <div className="create-conversation">
            <input
              type="text"
              placeholder="Enter participant IDs (comma-separated)"
              value={participantInput}
              onChange={(e) => setParticipantInput(e.target.value)}
            />
            <button onClick={createConversation}>Create Chat</button>
          </div>
          <ul className="conversation-list">
            {conversations.length === 0 ? (
              <li className="empty-conversation">
                No conversations yet. Create one above!
              </li>
            ) : (
              conversations.map((convo) => (
                <li
                  key={convo.id}
                  className={currentConversation?.id === convo.id ? 'active' : ''}
                  onClick={() => {
                    setCurrentConversation(convo);
                    setMessages(sdk?.getMessages(convo.id) || []);
                  }}
                >
                  <div className="conversation-info">
                    <div className="conversation-name">
                      {convo.name || `Chat with ${convo.participants.filter(p => p !== identity).join(', ')}`}
                    </div>
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="chat-area">
          {currentConversation ? (
            <>
              <div className="chat-header">
                <h2>{currentConversation.name || 'Direct Chat'}</h2>
                <div className="participants">
                  {currentConversation.participants.map(p => (
                    <span key={p} className={p === identity ? 'you' : ''}>
                      {p === identity ? 'You' : p.slice(0, 6)}...
                    </span>
                  ))}
                </div>
              </div>

              <div className="message-list">
                {getDisplayMessages().length === 0 ? (
                  <div className="empty-messages">
                    No messages yet. Send one below!
                  </div>
                ) : (
                  getDisplayMessages().map(msg => (
                    <div key={msg.id} className={`message ${msg.sender === identity ? 'outgoing' : 'incoming'}`}>
                      <div className="message-sender">
                        {msg.sender === identity ? 'You' : msg.sender.slice(0, 6)}...
                      </div>
                      <div className="message-content">{msg.content}</div>
                      <div className="message-actions">
                        {msg.sender === identity && (
                          <>
                            <button onClick={() => revokeMessage(msg.id)}>Revoke</button>
                            <button onClick={() => deleteMessage(msg.id)}>Delete</button>
                          </>
                        )}
                      </div>
                      <div className="message-time">
                        {new Date(msg.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="message-input-area">
                <input
                  type="text"
                  placeholder="Type a message..."
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                />
                <button onClick={sendMessage}>Send</button>
              </div>
            </>
          ) : (
            <div className="empty-state">
              Select or create a conversation to start chatting
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;