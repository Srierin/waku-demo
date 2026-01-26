import ChatSDK from '../sdk/chat-sdk';
import type { Message } from '../sdk/types';

describe('Chat SDK', () => {
  let sdk1: ChatSDK;
  let sdk2: ChatSDK;
  let sdk3: ChatSDK;
  let identity1: string;
  let identity2: string;
  let identity3: string;

  beforeAll(async () => {
    sdk1 = new ChatSDK();
    sdk2 = new ChatSDK();
    sdk3 = new ChatSDK();

    const user1 = await sdk1.init();
    const user2 = await sdk2.init();
    const user3 = await sdk3.init();

    identity1 = user1.peerId;
    identity2 = user2.peerId;
    identity3 = user3.peerId;
  });

  afterAll(async () => {
    await sdk1.close();
    await sdk2.close();
    await sdk3.close();
  });

  test('单聊互发消息', async () => {
    const conversation1 = await sdk1.createConversation([identity2], 'direct');
    const conversation2 = await sdk2.createConversation([identity1], 'direct');

    expect(conversation1.id).toBe(conversation2.id);

    const receivedMessages: Message[] = [];
    await sdk2.subscribe(conversation2.id, (message) => {
      receivedMessages.push(message);
    });

    const messageId = await sdk1.sendMessage(conversation1.id, 'Hello from user 1');
    expect(messageId).toBeDefined();

    // 等待消息接收
    await new Promise(resolve => setTimeout(resolve, 2000));

    expect(receivedMessages.length).toBeGreaterThan(0);
    expect(receivedMessages[0].content).toBe('Hello from user 1');
    expect(receivedMessages[0].sender).toBe(identity1);
  });

  test('群聊广播消息', async () => {
    const conversation1 = await sdk1.createConversation([identity2, identity3], 'group', 'Test Group');
    await sdk2.createConversation([identity1, identity3], 'group', 'Test Group');
    await sdk3.createConversation([identity1, identity2], 'group', 'Test Group');

    const receivedMessages2: Message[] = [];
    const receivedMessages3: Message[] = [];

    await sdk2.subscribe(conversation1.id, (message) => {
      receivedMessages2.push(message);
    });

    await sdk3.subscribe(conversation1.id, (message) => {
      receivedMessages3.push(message);
    });

    await sdk1.sendMessage(conversation1.id, 'Hello from user 1 to group');

    // 等待消息接收
    await new Promise(resolve => setTimeout(resolve, 3000));

    expect(receivedMessages2.length).toBeGreaterThan(0);
    expect(receivedMessages3.length).toBeGreaterThan(0);
    expect(receivedMessages2[0].content).toBe('Hello from user 1 to group');
    expect(receivedMessages3[0].content).toBe('Hello from user 1 to group');
  });

  test('消息撤回后各端一致显示', async () => {
    const conversation1 = await sdk1.createConversation([identity2], 'direct');
    const conversation2 = await sdk2.createConversation([identity1], 'direct');

    const receivedMessages: Message[] = [];
    await sdk2.subscribe(conversation2.id, (message) => {
      receivedMessages.push(message);
    });

    const messageId = await sdk1.sendMessage(conversation1.id, 'Message to be revoked');

    // 等待消息接收
    await new Promise(resolve => setTimeout(resolve, 2000));

    expect(receivedMessages.length).toBeGreaterThan(0);
    expect(receivedMessages.find(m => m.id === messageId)).toBeDefined();

    // 撤回消息
    await sdk1.revokeMessage(conversation1.id, messageId);

    // 等待撤回消息接收
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 验证sdk2收到了撤回消息
    const tombstoneMessage = receivedMessages.find(m => m.type === 'tombstone' && m.tombstoneFor === messageId);
    expect(tombstoneMessage).toBeDefined();

    // 验证sdk1和sdk2的消息列表中不再显示被撤回的消息
    const messages1 = sdk1.getMessages(conversation1.id);
    const visibleMessages1 = messages1.filter(m => {
      if (m.type === 'tombstone') return false;
      const isRevoked = messages1.some(t => t.type === 'tombstone' && t.tombstoneFor === m.id);
      return !isRevoked;
    });

    const messages2 = sdk2.getMessages(conversation2.id);
    const visibleMessages2 = messages2.filter(m => {
      if (m.type === 'tombstone') return false;
      const isRevoked = messages2.some(t => t.type === 'tombstone' && t.tombstoneFor === m.id);
      return !isRevoked;
    });

    expect(visibleMessages1.find(m => m.id === messageId)).toBeUndefined();
    expect(visibleMessages2.find(m => m.id === messageId)).toBeUndefined();
  });

  test('本地删除消息', async () => {
    const conversation1 = await sdk1.createConversation([identity2], 'direct');

    const messageId = await sdk1.sendMessage(conversation1.id, 'Message to be deleted');

    // 验证消息存在
    let messages = sdk1.getMessages(conversation1.id);
    expect(messages.find(m => m.id === messageId)).toBeDefined();

    // 本地删除消息
    sdk1.deleteMessageLocally(conversation1.id, messageId);

    // 验证消息已删除
    messages = sdk1.getMessages(conversation1.id);
    expect(messages.find(m => m.id === messageId)).toBeUndefined();
  });
});