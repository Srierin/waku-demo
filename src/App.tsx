import { useState, useEffect, useRef } from 'react';
import './App.css';
import ChatSDK from './sdk/chat-sdk';
import type { UserIdentity, Conversation, Message } from './sdk/types';

function App() {
  const [sdk, setSdk] = useState<ChatSDK | null>(null);
  const [identity, setIdentity] = useState<UserIdentity | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [participantId, setParticipantId] = useState('');
  const [conversationName, setConversationName] = useState('');
  const [isInitializing, setIsInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 初始化SDK
    const initSDK = async () => {
      try {
        setIsInitializing(true);
        const chatSDK = new ChatSDK({ storeMessages: true });
        const userIdentity = await chatSDK.init();
        setSdk(chatSDK);
        setIdentity(userIdentity);
        setConversations(chatSDK.getAllConversations());
      } catch (err) {
        console.error('Failed to initialize SDK:', err);
        setError('Failed to initialize SDK. Running in offline mode.');
      } finally {
        setIsInitializing(false);
      }
    };

    initSDK();
  }, []);

  useEffect(() => {
    // 监听localStorage事件，实现跨标签页和跨浏览器通信
    const handleStorageChange = (e: StorageEvent) => {
      // 检查是否是我们的消息事件
      if (e.key && e.key.startsWith('waku-chat-message-') && e.newValue) {
        try {
          const data = JSON.parse(e.newValue);
          if (data.type === 'new-message' && data.message) {
            // 处理来自其他标签页或浏览器的消息
            if (sdk && identity) {
              // 确保消息被正确处理
              const message = data.message;

              console.log(`Received message from other browser: ${message.id}`);

              // 检查会话是否存在，如果不存在则自动创建
              if (!sdk.getConversation(message.conversationId)) {
                console.log(`Conversation not found, creating new conversation: ${message.conversationId}`);
                // 从消息中获取参与者信息（消息发送者 + 当前用户），并进行排序
                const participants = [...new Set([message.sender, identity.peerId])].sort();

                // 创建会话
                sdk.createConversation(
                  [message.sender],
                  'direct',
                  `Chat with ${message.sender.slice(0, 6)}...`
                ).then(() => {
                  console.log('Auto-created conversation for message from other browser');
                  // 更新会话列表
                  setConversations(sdk.getAllConversations());
                  // 处理消息
                  sdk.storeMessage(message);
                  // 更新消息列表
                  if (currentConversation && message.conversationId === currentConversation.id) {
                    setMessages(sdk.getMessages(currentConversation.id));
                  }
                }).catch(err => {
                  console.error('Failed to auto-create conversation:', err);
                });
              } else {
                // 会话已存在，直接处理消息
                console.log(`Conversation found, processing message: ${message.id}`);
                sdk.storeMessage(message);
                // 更新消息列表
                if (currentConversation && message.conversationId === currentConversation.id) {
                  setMessages(sdk.getMessages(currentConversation.id));
                }
              }

              // 更新会话列表
              setConversations(sdk.getAllConversations());
            }
          }
        } catch (err) {
          console.error('Failed to parse localStorage message:', err);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [sdk, currentConversation, identity]);

  // 滚动到最新消息
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 处理消息接收
  useEffect(() => {
    if (sdk) {
      const handleMessage = (message: Message) => {
        // 更新会话列表，确保新创建的会话能够显示在UI中
        setConversations(sdk.getAllConversations());

        // 如果当前会话是消息所属的会话，更新消息列表
        if (currentConversation && message.conversationId === currentConversation.id) {
          setMessages(prev => {
            // 避免重复消息
            if (prev.some(m => m.id === message.id)) {
              return prev;
            }
            return [...prev, message];
          });
        }
      };

      // 订阅所有现有会话的消息
      sdk.getAllConversations().forEach(conversation => {
        sdk.subscribe(conversation.id, handleMessage);
      });

      return () => {
        // 清理订阅
      };
    }
  }, [sdk]);

  // 当会话列表变化时，确保所有会话都被订阅
  useEffect(() => {
    if (sdk) {
      const handleMessage = (message: Message) => {
        // 更新会话列表，确保新创建的会话能够显示在UI中
        setConversations(sdk.getAllConversations());

        // 如果当前会话是消息所属的会话，更新消息列表
        if (currentConversation && message.conversationId === currentConversation.id) {
          setMessages(prev => {
            // 避免重复消息
            if (prev.some(m => m.id === message.id)) {
              return prev;
            }
            return [...prev, message];
          });
        }
      };

      // 订阅所有会话的消息
      sdk.getAllConversations().forEach(conversation => {
        sdk.subscribe(conversation.id, handleMessage);
      });
    }
  }, [sdk, conversations]);

  // 加载当前会话的消息
  useEffect(() => {
    if (sdk && currentConversation) {
      const loadMessages = async () => {
        const conversationMessages = sdk.getMessages(currentConversation.id);
        setMessages(conversationMessages);
      };

      loadMessages();
    }
  }, [sdk, currentConversation]);

  const handleCreateConversation = async () => {
    if (!sdk || !identity || !participantId) {
      setError('Please enter a participant ID');
      return;
    }

    try {
      const conversation = await sdk.createConversation(
        [participantId],
        'direct',
        conversationName || `Chat with ${participantId.slice(0, 6)}...`
      );
      setConversations(prev => [...prev, conversation]);
      setCurrentConversation(conversation);
      setParticipantId('');
      setConversationName('');
      setError(null);
    } catch (err) {
      console.error('Failed to create conversation:', err);
      setError('Failed to create conversation');
    }
  };

  const handleSendMessage = async () => {
    if (!sdk || !currentConversation || !messageInput.trim()) {
      return;
    }

    try {
      await sdk.sendMessage(currentConversation.id, messageInput.trim());
      setMessageInput('');
      setError(null);
    } catch (err) {
      console.error('Failed to send message:', err);
      setError('Failed to send message');
    }
  };

  const handleRevokeMessage = async (messageId: string) => {
    if (!sdk || !currentConversation) {
      return;
    }

    try {
      await sdk.revokeMessage(currentConversation.id, messageId);
      // 更新本地消息状态
      setMessages(prev => prev.map(msg =>
        msg.id === messageId ? { ...msg, isRevoked: true, content: 'This message has been revoked.' } : msg
      ));
      setError(null);
    } catch (err) {
      console.error('Failed to revoke message:', err);
      setError('Failed to revoke message');
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!sdk || !currentConversation) {
      return;
    }

    try {
      // 本地删除消息
      sdk.deleteMessageLocally(currentConversation.id, messageId);
      // 更新本地消息状态
      setMessages(prev => prev.filter(msg => msg.id !== messageId));
      setError(null);
    } catch (err) {
      console.error('Failed to delete message:', err);
      setError('Failed to delete message');
    }
  };

  const handleCopyIdentity = () => {
    if (identity) {
      navigator.clipboard.writeText(identity.peerId)
        .then(() => alert('Identity copied to clipboard'))
        .catch(err => console.error('Failed to copy identity:', err));
    }
  };

  const getDisplayMessages = (): Message[] => {
    if (!messages.length) return [];

    // 处理消息撤回
    const revokedMessageIds = new Set(
      messages.filter(msg => msg.type === 'tombstone').map(msg => msg.tombstoneFor!)
    );

    return messages
      .filter(msg => msg.type !== 'tombstone') // 过滤掉墓碑消息
      .map(msg => ({
        ...msg,
        isRevoked: revokedMessageIds.has(msg.id)
      }));
  };

  if (isInitializing) {
    return (
      <div className="app">
        <h1>Mini Encrypted Chat</h1>
        <p>Initializing SDK...</p>
      </div>
    );
  }

  return (
    <div className="app">
      <h1>Mini Encrypted Chat</h1>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      <div className="identity-section">
        <h2>Your Identity</h2>
        <p className="identity-id">{identity?.peerId}</p>
        <button onClick={handleCopyIdentity} className="copy-button">
          Copy Identity
        </button>
      </div>

      <div className="create-conversation">
        <h2>Create Conversation</h2>
        <input
          type="text"
          placeholder="Participant ID"
          value={participantId}
          onChange={(e) => setParticipantId(e.target.value)}
          className="participant-input"
        />
        <input
          type="text"
          placeholder="Conversation Name (optional)"
          value={conversationName}
          onChange={(e) => setConversationName(e.target.value)}
          className="conversation-name-input"
        />
        <button onClick={handleCreateConversation} className="create-button">
          Create Conversation
        </button>
      </div>

      <div className="chat-container">
        <div className="conversations-list">
          <h2>Conversations</h2>
          {conversations.length === 0 ? (
            <p>No conversations yet. Create one above.</p>
          ) : (
            <ul>
              {conversations.map(conversation => (
                <li
                  key={conversation.id}
                  onClick={() => setCurrentConversation(conversation)}
                  className={currentConversation?.id === conversation.id ? 'active' : ''}
                >
                  <div className="conversation-name">
                    {conversation.name || conversation.participants.filter(p => p !== identity?.peerId)[0]?.slice(0, 6)}...
                  </div>
                  <div className="conversation-participants">
                    {conversation.participants.length} participants
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="chat-area">
          {currentConversation ? (
            <>
              <div className="chat-header">
                <h2>{currentConversation.name || `Chat with ${currentConversation.participants.filter(p => p !== identity?.peerId)[0]?.slice(0, 6)}...`}</h2>
                <div className="conversation-id">
                  Conversation ID: {currentConversation.id}
                </div>
              </div>

              <div className="messages-list">
                {getDisplayMessages().length === 0 ? (
                  <p>No messages yet. Send one below.</p>
                ) : (
                  getDisplayMessages().map(message => (
                    <div
                      key={message.id}
                      className={`message ${message.sender === identity?.peerId ? 'own' : 'other'}`}
                    >
                      <div className="message-header">
                        <span className="message-sender">
                          {message.sender === identity?.peerId ? 'You' : message.sender.slice(0, 6)}...
                        </span>
                        <span className="message-time">
                          {new Date(message.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className={`message-content ${message.isRevoked ? 'revoked' : ''}`}>
                        {message.isRevoked ? 'This message has been revoked.' : message.content}
                      </div>
                      {message.sender === identity?.peerId && !message.isRevoked && (
                        <div className="message-actions">
                          <button
                            onClick={() => handleRevokeMessage(message.id)}
                            className="message-action-button revoke-button"
                          >
                            Revoke
                          </button>
                          <button
                            onClick={() => handleDeleteMessage(message.id)}
                            className="message-action-button delete-button"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              <div className="message-input-area">
                <input
                  type="text"
                  placeholder="Type a message..."
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                  className="message-input"
                />
                <button onClick={handleSendMessage} className="send-button">
                  Send
                </button>
              </div>
            </>
          ) : (
            <div className="no-conversation">
              <p>Select a conversation or create a new one.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;