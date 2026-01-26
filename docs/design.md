# 迷你加密聊天 SDK 设计文档

## 1. 概述

本设计文档描述了基于 Waku 协议的“迷你加密聊天”SDK 的实现方案。该 SDK 提供了一个最小可用的聊天层，支持单聊、群聊、消息撤回与删除功能。

## 2. 技术栈

- **核心协议**: Waku (v2)
- **SDK**: @waku/sdk (JavaScript/TypeScript)
- **依赖**: ethers@6, uuid
- **传输层**: LightPush + Filter (轻节点模式)
- **存储**: 本地内存存储 + 可选的 Waku Store

## 3. 关键概念

### 3.1 pubsub topic 与 content topic

- **pubsub topic**: 路由层概念，用于节点间的消息路由。默认使用 `/waku/2/default-waku/proto`，所有节点共享此 topic 进行消息广播。
- **content topic**: 应用层概念，用于区分不同的消息类型和会话。本 SDK 使用 `/chat/{conversationId}/proto` 格式，确保不同会话的消息相互隔离。

### 3.2 轻节点模式选择

选择 **LightPush + Filter** 模式的原因：
- **LightPush**: 允许轻节点向网络推送消息，而不需要维护完整的消息池
- **Filter**: 允许轻节点订阅特定 content topic 的消息，只接收感兴趣的内容
- **资源效率**: 轻节点模式消耗更少的带宽和内存，适合客户端场景
- **可扩展性**: 支持更多节点同时在线，不会因为节点数量增加而显著降低性能

### 3.3 消息唯一标识

- 使用 **UUID v4** 作为消息唯一标识 (`message.id`)
- 可追溯性: 每条消息都有唯一 ID，支持撤回操作的精确识别
- 去重: 基于消息 ID 可以实现客户端级别的消息去重

### 3.4 撤回/删除机制

**去中心化网络的现实边界**:
- 无法强制所有节点删除已传播的消息
- 无法保证所有节点都收到撤回指令
- 无法阻止恶意节点存储和重新发布消息

**实现方案**:
- **撤回**: 发送 `tombstone` 控制消息，包含被撤回消息的 ID，客户端收到后隐藏对应消息
- **删除**: 仅在本地存储中移除消息，不影响其他节点
- **验证**: 撤回消息必须由原发送者发起，确保权限控制

## 4. 架构设计

### 4.1 核心组件

1. **ChatSDK 类**: 主要接口，提供初始化、会话管理、消息发送接收等功能
2. **身份管理**: 基于以太坊钱包生成的密钥对
3. **会话管理**: 维护会话列表和参与者信息
4. **消息处理**: 处理消息的发送、接收、加密、解密
5. **存储管理**: 本地消息存储和历史消息拉取

### 4.2 数据模型

#### 4.2.1 用户身份
```typescript
interface UserIdentity {
  peerId: string;        // 基于钱包地址生成
  privateKey: string;    // 用于签名和加密
  publicKey: string;     // 用于验证和加密
}
```

#### 4.2.2 会话
```typescript
interface Conversation {
  id: string;            // 会话唯一标识
  type: 'direct' | 'group'; // 会话类型
  participants: string[]; // 参与者的 peerId
  name?: string;         // 群聊名称
}
```

#### 4.2.3 消息
```typescript
interface Message {
  id: string;            // 消息唯一标识
  conversationId: string; // 所属会话 ID
  sender: string;        // 发送者的 peerId
  content: string;       // 消息内容
  timestamp: number;     // 发送时间戳
  type: 'text' | 'tombstone'; // 消息类型
  tombstoneFor?: string; // 被撤回的消息 ID
}
```

## 5. 消息格式与加密

### 5.1 消息格式

- 使用 **JSON** 格式序列化消息
- 包含版本控制字段，便于后续扩展
- 支持文本消息和控制消息（tombstone）

### 5.2 加密策略

**当前实现**:
- 使用 Waku Message 的 payload 字段传输序列化后的消息
- 利用 Waku 的内置加密机制（WAKU2-NOISE）
- 会话密钥基于会话 ID 和用户私钥生成，确保每个会话使用不同的加密密钥

**安全保证**:
- **机密性**: 消息在传输过程中使用会话密钥加密
- **完整性**: 基于 Waku 的签名机制确保消息未被篡改
- **认证**: 只有会话参与者能够解密和读取消息

## 6. Topic 规划

### 6.1 单聊 Topic

- **content topic**: `/chat/{participant1}_{participant2}/proto`
- **规则**: 参与者 ID 按字典序排序，确保双方使用相同的 topic

### 6.2 群聊 Topic

- **content topic**: `/chat/group_{uuid}/proto`
- **规则**: 使用随机生成的 UUID 作为群聊标识，确保唯一性

## 7. 功能实现

### 7.1 初始化

```typescript
async init(identity?: UserIdentity): Promise<UserIdentity>
```
- 启动 Waku 节点
- 连接到远程对等节点
- 初始化本地存储

### 7.2 会话管理

```typescript
async createConversation(participants: string[], type: 'direct' | 'group', name?: string): Promise<Conversation>
```
- 生成会话 ID
- 创建会话对象
- 订阅对应的 content topic

### 7.3 消息发送

```typescript
async sendMessage(conversationId: string, content: string): Promise<string>
```
- 生成消息 ID
- 构造消息对象
- 序列化并加密
- 通过 LightPush 发送到网络

### 7.4 消息接收

```typescript
async subscribe(conversationId: string, handler: MessageHandler): Promise<void>
```
- 通过 Filter 订阅特定 content topic
- 接收并解密消息
- 调用回调函数处理消息

### 7.5 消息撤回

```typescript
async revokeMessage(conversationId: string, messageId: string): Promise<string>
```
- 生成 tombstone 消息
- 发送到对应的会话
- 客户端收到后隐藏被撤回的消息

### 7.6 消息删除

```typescript
deleteMessageLocally(conversationId: string, messageId: string): void
```
- 仅在本地存储中移除消息
- 不影响其他节点的消息存储

## 8. 安全考虑

### 8.1 消息加密
- 使用会话级别的加密密钥
- 每个会话使用不同的密钥，提高安全性
- 基于用户私钥生成，确保只有授权用户能够解密

### 8.2 身份验证
- 基于以太坊钱包的密钥对进行身份验证
- 确保消息发送者的身份可验证
- 防止未授权用户发送消息

### 8.3 权限控制
- 只有原发送者可以撤回自己的消息
- 群聊管理员可以撤回所有消息（预留功能）

## 9. 测试环境

### 9.1 本地网络启动
- 使用 `@waku/run` 启动本地 nwaku 节点
- 配置多个节点组成测试网络
- 确保节点间能够正常通信

### 9.2 测试场景
- **单聊测试**: 两个用户互相发送消息
- **群聊测试**: 三个以上用户加入同一群聊
- **撤回测试**: 发送消息后撤回，验证其他端是否隐藏
- **删除测试**: 本地删除消息，验证不影响其他端

## 10. 局限性与未来改进

### 10.1 局限性
- **消息存储**: 默认仅存储在内存中，刷新页面后丢失
- **历史消息**: 未实现完整的 Store 拉取功能
- **离线消息**: 离线期间的消息可能无法及时接收
- **加密强度**: 当前使用基本的加密方案，可进一步加强

### 10.2 未来改进
- **持久化存储**: 集成本地存储（如 IndexedDB）
- **完整的 Store 支持**: 实现历史消息拉取
- **消息同步**: 实现多设备消息同步
- **增强加密**: 使用更高级的加密方案
- **权限系统**: 实现更细粒度的权限控制

## 11. 结论

本 SDK 实现了一个基于 Waku 协议的最小可用聊天层，满足了单聊、群聊、消息撤回与删除的基本需求。通过轻节点模式和合理的 Topic 规划，实现了高效、安全的去中心化通信。

虽然存在一些局限性，但作为一个最小可用的实现，已经能够展示 Waku 协议在隐私友好通信中的应用潜力。未来可以通过持续改进，逐步实现更完整的聊天功能。