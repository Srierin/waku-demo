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

  useEffect(() => {
    initSDK();
  }, []);

  const initSDK = async () => {
    try {
      setIsInitializing(true);
      const chatSDK = new ChatSDK({ storeMessages: true });
      const userIdentity = await chatSDK.init();
      setSdk(chatSDK);
      setIdentity(userIdentity.peerId);
      setConnectionStatus('Connected');

      console.log('SDK initialized successfully');
    } catch (error) {
      console.error('Failed to initialize SDK:', error);
      alert('Failed to initialize SDK. Please refresh the page and try again.');
      setConnectionStatus('Disconnected');
    } finally {
      setIsInitializing(false);
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

      // 订阅会话消息 - 添加全局消息处理，确保能收到来自任何会话的消息
      await sdk.subscribe(conversation.id, (message) => {
        console.log('Received message:', message);

        // 如果当前会话是消息所属的会话，更新消息列表
        if (currentConversation?.id === message.conversationId) {
          setMessages(prev => [...prev, message]);
        }
        // 如果是新会话的消息，自动创建会话UI
        else {
          // 检查会话是否已经存在于UI中
          const existingConvo = conversations.find(c => c.id === message.conversationId);
          if (!existingConvo) {
            // 从SDK获取完整会话信息
            const sdkConvo = sdk.getConversation(message.conversationId);
            if (sdkConvo) {
              setConversations(prev => [...prev, sdkConvo]);
            }
          }
        }
      });

      // 更新状态
      setConversations(prev => [...prev, conversation]);
      setCurrentConversation(conversation);
      setMessages([]);
      setParticipantInput('');
      alert('Conversation created successfully!');
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
          <div className={`connection-status ${connectionStatus === 'Connected' ? 'connected' : 'disconnected'}`}>
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
              conversations.map(convo => (
                <li
                  key={convo.id}
                  className={currentConversation?.id === convo.id ? 'active' : ''}
                  onClick={async () => {
                    if (!sdk) return;

                    // 切换会话
                    setCurrentConversation(convo);

                    // 加载已有消息
                    const existingMessages = sdk.getMessages(convo.id);
                    setMessages(existingMessages);

                    console.log('Switched to conversation:', convo.id);
                  }}
                >
                  {convo.name || `Chat with ${convo.participants.filter(p => p !== identity).join(', ')}`}
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
