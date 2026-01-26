# 迷你加密聊天 SDK

基于 Waku 协议的“最小可用”加密聊天 SDK，支持单聊、群聊、消息撤回与删除功能。

## 功能特性

- ✅ **单聊**：两个用户之间的加密通信
- ✅ **群聊**：多个用户的加密群组通信
- ✅ **消息撤回**：发送墓碑消息，让其他客户端隐藏对应消息
- ✅ **消息删除**：本地删除消息，不影响其他端
- ✅ **轻节点模式**：基于 LightPush + Filter，资源消耗低
- ✅ **加密传输**：消息在传输过程中加密
- ✅ **本地存储**：支持本地消息存储
- ✅ **消息去重**：基于 messageId 的去重机制
- ✅ **历史消息拉取**：支持从 Store 节点拉取历史消息

## 技术栈

- **核心协议**：Waku (v2)
- **SDK**：@waku/sdk
- **前端框架**：React + TypeScript
- **构建工具**：Vite
- **加密库**：ethers.js
- **测试框架**：Jest

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 启动前端开发服务器

```bash
npm run dev
```

访问 http://localhost:5173/ 即可使用应用。

### 3. 启动本地 Waku 节点（可选）

使用提供的批处理脚本一键启动本地 Waku 节点：

```bash
# Windows
start-waku-node.bat
```

### 4. 构建生产版本

```bash
npm run build
```

## 使用说明

### 1. 查看身份 ID

启动应用后，顶部会显示你的唯一身份 ID。

### 2. 创建会话

#### 单聊

1. 在侧边栏输入对方的身份 ID
2. 点击 "Create Chat"
3. 在聊天窗口输入消息并发送

#### 群聊

1. 在侧边栏输入多个身份 ID（用逗号分隔）
2. 点击 "Create Chat"
3. 在聊天窗口输入消息并发送

### 3. 撤回消息

点击消息下方的 "Revoke" 按钮，该消息会在所有参与者的界面中隐藏。

### 4. 删除消息

点击消息下方的 "Delete" 按钮，该消息会仅在本地删除。

## 架构设计

### 1. 核心组件

- **ChatSDK 类**：主要接口，提供初始化、会话管理、消息发送接收等功能
- **身份管理**：基于以太坊钱包生成的密钥对
- **会话管理**：维护会话列表和参与者信息
- **消息处理**：处理消息的发送、接收、加密、解密
- **存储管理**：本地消息存储和历史消息拉取

### 2. Topic 规划

- **pubsub topic**：使用默认的 `/waku/2/default-waku/proto`，用于节点间的消息路由
- **content topic**：使用 `/chat/{conversationId}/proto` 格式，用于区分不同的会话

### 3. 消息格式

```json
{
  "id": "string",          // 消息唯一标识（UUID v4）
  "conversationId": "string",  // 所属会话 ID
  "sender": "string",       // 发送者的 peerId
  "content": "string",      // 消息内容
  "timestamp": "number",    // 发送时间戳
  "type": "text" | "tombstone",  // 消息类型
  "tombstoneFor": "string"  // 被撤回的消息 ID（仅用于墓碑消息）
}
```

### 4. 加密机制

- **加密层**：Waku Message 的 payload 加密
- **加密方案**：基于会话密钥的 AES-256-GCM 加密
- **密钥生成**：使用会话 ID 和用户私钥生成会话密钥
- **密钥管理**：每个会话使用独立的加密密钥

## 本地测试网络

### 1. 启动本地 Waku 节点

使用提供的批处理脚本一键启动本地 Waku 节点：

```bash
# Windows
start-waku-node.bat
```

### 2. 配置 SDK 连接本地节点

修改 `src/sdk/chat-sdk.ts` 文件中的 `bootstrapNodes` 数组：

```typescript
const bootstrapNodes = [
  '/ip4/127.0.0.1/tcp/60000/p2p/16Uiu2HAmPLe7Mzm8TsYUubgCAW1aJoeFScxrLj8ppHFivPo97bUZ',
];
```

### 3. 验证本地节点

访问 http://localhost:8545 查看节点 RPC 接口状态。

## 测试

### 1. 运行单元测试

```bash
npm test
```

### 2. 测试场景

#### 单聊测试
1. 打开两个浏览器窗口
2. 查看各自的身份 ID
3. 在第一个窗口创建会话，输入第二个窗口的身份 ID
4. 发送消息，验证第二个窗口是否收到

#### 群聊测试
1. 打开三个以上浏览器窗口
2. 查看各自的身份 ID
3. 在第一个窗口创建会话，输入其他窗口的身份 ID
4. 发送消息，验证所有窗口是否收到

#### 撤回测试
1. 发送一条消息
2. 点击消息下方的 "Revoke" 按钮
3. 验证消息在所有窗口中隐藏

#### 删除测试
1. 发送一条消息
2. 点击消息下方的 "Delete" 按钮
3. 验证消息仅在本地删除，其他窗口仍可见

## 设计文档

详细的设计文档请参考 `docs/design.md`，包含以下内容：

- 协议封装设计
- Topic 规划
- 安全方案
- 撤回删除边界说明
- 关键概念解释

## 离线模式

应用支持离线模式，所有消息仅存储在本地内存中：

- 无需网络连接
- 消息仅在当前浏览器标签页中可见
- 刷新页面后消息会丢失
- 适合测试 UI 和基本功能

## 局限性

- **离线消息**：离线期间的消息无法接收
- **消息持久化**：刷新页面后消息会丢失
- **网络依赖**：需要稳定的网络连接
- **加密强度**：当前使用基本的加密方案

## 未来改进

- 实现完整的 Waku Message 加密
- 支持从 Store 节点拉取历史消息
- 实现消息的持久化存储
- 添加更复杂的用户界面
- 支持好友系统和用户搜索

## 许可证

MIT
=======
# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
