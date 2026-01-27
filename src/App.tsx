import { useState, useEffect } from 'react';
import ChatSDK from './sdk/chat-sdk';
import type { Message, Conversation } from './sdk/types';

import { v4 as uuidv4 } from 'uuid';

import './App.css';

function App() {
  const [sdk, setSdk] = useState<ChatSDK | null>(null);
  const [identity, setIdentity] = useState<string>('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [participantInput, setParticipantInput] = useState('');
  const [isInitializing, setIsInitializing] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<string>('Connecting...');
  const [testMode, setTestMode] = useState(false);
  const [testUserIdentity, setTestUserIdentity] = useState<string>('');
  const [testUserSdk, setTestUserSdk] = useState<ChatSDK | null>(null);
  // 本地消息存储，用于在测试模式下保存所有消息
  const [localMessageStore, setLocalMessageStore] = useState<Map<string, Message[]>>(new Map());


  useEffect(() => {
    initSDK();
  }, []);

  const initSDK = async () => {
    try {
      setIsInitializing(true);

      // 初始化主SDK
      const chatSDK = new ChatSDK({ storeMessages: true });
      const userIdentity = await chatSDK.init();
      setSdk(chatSDK);
      setIdentity(userIdentity.peerId);

      // 加载现有的会话和消息
      loadExistingConversations(chatSDK);

      setConnectionStatus('Connected');

      console.log('SDK initialized successfully');
      console.log('Your identity:', userIdentity.peerId);

      // 显示初始化成功提示
      alert('SDK initialized successfully!\n\nYour ID: ' + userIdentity.peerId + '\n\nYou can now:\n1. Create a conversation with another user\n2. Send messages to the conversation\n3. Test message revocation and deletion\n4. Use test mode for local testing without network');
    } catch (error) {
      console.error('Failed to initialize SDK:', error);

      // 尝试在离线模式下初始化
      try {
        const chatSDK = new ChatSDK({ storeMessages: true });
        const userIdentity = await chatSDK.init();
        setSdk(chatSDK);
        setIdentity(userIdentity.peerId);

        // 加载现有的会话和消息
        loadExistingConversations(chatSDK);

        setConnectionStatus('Offline Mode');
        console.log('Running in offline mode');
        alert('Running in offline mode!\n\nYour ID: ' + userIdentity.peerId + '\n\nYou can still test basic features locally.');
      } catch (innerError) {
        console.error('Failed to initialize in offline mode:', innerError);
        alert('Failed to initialize SDK. Please refresh the page and try again.');
        setConnectionStatus('Error');
      }
    } finally {
      setIsInitializing(false);
    }
  };

  const loadExistingConversations = (chatSDK: ChatSDK) => {
    // 加载所有现有会话
    try {
      const existingConversations = chatSDK.getAllConversations();
      if (existingConversations.length > 0) {
        setConversations(existingConversations);
        console.log('Loaded', existingConversations.length, 'existing conversations');
      } else {
        console.log('No existing conversations found');
      }
    } catch (error) {
      console.error('Failed to load existing conversations:', error);
    }
  };

  const toggleTestMode = async () => {
    if (!testMode) {
      // 启用测试模式
      try {
        const testSDK = new ChatSDK({ storeMessages: true });
        const testIdentity = await testSDK.init();
        setTestUserSdk(testSDK);
        setTestUserIdentity(testIdentity.peerId);
        setTestMode(true);
        alert(`Test mode enabled. Test user ID: ${testIdentity.peerId}`);
      } catch (error) {
        console.error('Failed to initialize test SDK:', error);
        alert('Failed to initialize test SDK.');
      }
    } else {
      // 禁用测试模式
      if (testUserSdk) {
        await testUserSdk.close();
      }
      setTestUserSdk(null);
      setTestUserIdentity('');
      setTestMode(false);
    }
  };

  const sendTestMessage = async () => {
    console.log('sendTestMessage called');
    console.log('testUserIdentity:', testUserIdentity);
    console.log('currentConversation:', currentConversation);
    console.log('messageInput:', messageInput);
    console.log('testMode:', testMode);

    if (!testMode || !testUserIdentity || !currentConversation || !messageInput.trim()) {
      console.log('Validation failed');
      alert('Please select a conversation and enter a message');
      return;
    }

    try {
      console.log('Sending message as test user');

      // 直接创建消息，不依赖于网络连接
      const messageId = `test_${Date.now()}`;

      // 手动创建消息对象
      const newMessage: Message = {
        id: messageId,
        conversationId: currentConversation.id,
        sender: testUserIdentity,
        content: messageInput,
        timestamp: Date.now(),
        type: 'text',
        signature: ''
      };

      console.log('Created test message:', newMessage);

      // 添加消息到当前用户的消息列表
      setMessages(prev => {
        // 检查消息是否已经存在，避免重复
        if (!prev.some(msg => msg.id === messageId)) {
          return [...prev, newMessage];
        }
        return prev;
      });

      // 确保会话在左侧列表中存在
      setConversations(prevConversations => {
        const existingConvo = prevConversations.find(c => c.id === currentConversation.id);
        if (!existingConvo) {
          return [...prevConversations, currentConversation];
        }
        return prevConversations;
      });

      // 同时将消息存储到本地消息存储中
      setLocalMessageStore(prev => {
        const newStore = new Map(prev);
        const conversationMessages = newStore.get(currentConversation.id) || [];
        // 检查消息是否已经存在，避免重复
        if (!conversationMessages.some(msg => msg.id === messageId)) {
          newStore.set(currentConversation.id, [...conversationMessages, newMessage]);
        }
        return newStore;
      });

      // 如果testUserSdk可用，尝试通过Waku网络发送消息，实现真正的双向通信
      if (testUserSdk) {
        try {
          await testUserSdk.sendMessage(currentConversation.id, messageInput);
          console.log('Message sent through Waku network as test user');
        } catch (error) {
          console.log('Failed to send message through Waku network, but message was added locally');
        }
      }

      setMessageInput('');
      console.log('Message sent successfully');
    } catch (error) {
      console.error('Failed to send test message:', error);
      alert('Failed to send test message. Please try again.');
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
        // 订阅会话消息 - 添加消息处理函数
        await sdk.subscribe(conversation.id, (message) => {
          console.log('Received message:', message);

          // 首先检查会话是否已经存在于UI中，如果不存在则自动创建
          setConversations(prevConversations => {
            // 检查会话是否已经存在于UI中
            const existingConvo = prevConversations.find(c => c.id === message.conversationId);
            if (!existingConvo) {
              // 从SDK获取完整会话信息
              const sdkConvo = sdk.getConversation(message.conversationId);
              if (sdkConvo) {
                console.log('Auto-creating conversation for received message:', message.conversationId);
                return [...prevConversations, sdkConvo];
              }
            }
            return prevConversations;
          });

          // 检查消息是否已经存在于本地消息存储中
          const existingMessages = localMessageStore.get(message.conversationId) || [];
          if (!existingMessages.some(msg => msg.id === message.id)) {
            // 如果当前会话是消息所属的会话，更新消息列表
            if (currentConversation?.id === message.conversationId) {
              setMessages(prev => {
                // 检查消息是否已经存在，避免重复
                if (!prev.some(msg => msg.id === message.id)) {
                  return [...prev, message];
                }
                return prev;
              });
            }

            // 同时将接收到的消息存储到本地消息存储中
            setLocalMessageStore(prev => {
              const newStore = new Map(prev);
              const conversationMessages = newStore.get(message.conversationId) || [];
              // 检查消息是否已经存在，避免重复
              if (!conversationMessages.some(msg => msg.id === message.id)) {
                newStore.set(message.conversationId, [...conversationMessages, message]);
              }
              return newStore;
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
        type: 'text',
        signature: ''
      };
      setMessages(prev => [...prev, newMessage]);

      // 同时将消息存储到本地消息存储中
      setLocalMessageStore(prev => {
        const newStore = new Map(prev);
        const conversationMessages = newStore.get(currentConversation.id) || [];
        newStore.set(currentConversation.id, [...conversationMessages, newMessage]);
        return newStore;
      });
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
        id: uuidv4(),
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
      .filter(msg => msg.type !== 'tombstone') // 过滤掉墓碑消息本身
      .map(msg => {
        // 如果消息被撤回，修改内容
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
          <div className={`connection-status ${connectionStatus === 'Connected' ? 'connected' : connectionStatus === 'Offline Mode' ? 'offline' : connectionStatus === 'Test Mode' ? 'test' : 'disconnected'}`}>
            {connectionStatus}
          </div>
          <button onClick={toggleTestMode} className="test-mode-button">
            {testMode ? 'Disable Test Mode' : 'Enable Test Mode'}
          </button>
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
              conversations.map((convo, index) => (
                <li
                  key={`${convo.id}-${index}`}
                  className={currentConversation?.id === convo.id ? 'active' : ''}
                  onClick={() => {
                    setCurrentConversation(convo);
                    // 加载消息时，确保包含测试用户发送的消息
                    // 优先从本地消息存储中加载消息
                    const localMessages = localMessageStore.get(convo.id) || [];
                    // 如果本地存储中没有消息，再从SDK中加载
                    const sdkMessages = sdk?.getMessages(convo.id) || [];
                    // 合并消息并去重
                    const allMessages = [...new Map([...localMessages, ...sdkMessages].map(msg => [msg.id, msg])).values()];
                    // 按时间排序
                    allMessages.sort((a, b) => a.timestamp - b.timestamp);
                    setMessages(allMessages);
                  }}
                >
                  <div className="conversation-info">
                    <div className="conversation-name">
                      {convo.name || `Chat with ${convo.participants.filter(p => p !== identity).join(', ')}`}
                    </div>
                    <div className="conversation-actions">
                      <button
                        className="quick-send-button"
                        onClick={(e) => {
                          e.stopPropagation();
                          console.log('Quick send button clicked for conversation:', convo.id);
                          setCurrentConversation(convo);
                          // 加载消息时，确保包含测试用户发送的消息
                          // 优先从本地消息存储中加载消息
                          const localMessages = localMessageStore.get(convo.id) || [];
                          // 如果本地存储中没有消息，再从SDK中加载
                          const sdkMessages = sdk?.getMessages(convo.id) || [];
                          // 合并消息并去重
                          const allMessages = [...new Map([...localMessages, ...sdkMessages].map(msg => [msg.id, msg])).values()];
                          // 按时间排序
                          allMessages.sort((a, b) => a.timestamp - b.timestamp);
                          setMessages(allMessages);
                        }}
                      >
                        Send Message
                      </button>
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
                        {msg.sender === identity ? 'You' : msg.sender === testUserIdentity ? 'Test User' : msg.sender.slice(0, 6)}...
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
                  onKeyPress={(e) => e.key === 'Enter' && (testMode ? sendTestMessage() : sendMessage())}
                />
                {testMode ? (
                  <>
                    <button onClick={sendMessage}>Send as You</button>
                    <button onClick={sendTestMessage}>Send as Test User</button>
                  </>
                ) : (
                  <button onClick={sendMessage}>Send</button>
                )}
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
