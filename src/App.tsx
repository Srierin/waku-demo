import { useState, useEffect } from 'react';
import ChatSDK from './sdk/chat-sdk';
import type { Message, Conversation } from './sdk/types';
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

      // 监听消息
      chatSDK.subscribe('default', (message) => {
        if (message.conversationId === currentConversation?.id) {
          setMessages(prev => [...prev, message]);
        }
      });
    } catch (error) {
      console.error('Failed to initialize SDK:', error);
    } finally {
      setIsInitializing(false);
    }
  };

  const createConversation = async () => {
    if (!sdk || !participantInput) return;

    try {
      const participants = participantInput.split(',').map(p => p.trim());
      const conversation = await sdk.createConversation(participants, 'direct');
      setConversations(prev => [...prev, conversation]);
      setCurrentConversation(conversation);
      setMessages([]);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  const sendMessage = async () => {
    if (!sdk || !currentConversation || !messageInput) return;

    try {
      await sdk.sendMessage(currentConversation.id, messageInput);
      setMessageInput('');
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  const revokeMessage = async (messageId: string) => {
    if (!sdk || !currentConversation) return;

    try {
      await sdk.revokeMessage(currentConversation.id, messageId);
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

    return messages.filter(msg => {
      if (msg.type === 'tombstone') return false;
      return !tombstoneMap.has(msg.id);
    });
  };

  if (isInitializing) {
    return <div className="app">Initializing SDK...</div>;
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Mini Encrypted Chat</h1>
        <div className="identity">Your ID: {identity}</div>
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
            {conversations.map(convo => (
              <li
                key={convo.id}
                className={currentConversation?.id === convo.id ? 'active' : ''}
                onClick={() => {
                  setCurrentConversation(convo);
                  setMessages(sdk?.getMessages(convo.id) || []);
                }}
              >
                {convo.name || `Chat with ${convo.participants.filter(p => p !== identity).join(', ')}`}
              </li>
            ))}
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
                {getDisplayMessages().map(msg => (
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
                  </div>
                ))}
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
