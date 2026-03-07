# OpenClaw 核心设计总结

> **本文档用途**：分析 OpenClaw 的核心架构设计，为 **WeClaw** 项目提供架构参考。
> 
> **WeClaw** 是基于 OpenClaw 架构理念的轻量级微信 AI 助理，保留了核心的 Gateway、Agent、Session 和 Tool 系统，去除了多渠道集成、复杂插件等功能，专注于微信生态。

---

## 一、项目定位与概述

**OpenClaw** 是一个**个人 AI 助理平台**，核心理念是：
- **本地优先（Local-first）**：运行在你自己的设备上
- **多通道（Multi-channel）**：连接 WhatsApp、Telegram、Slack、Discord、Signal、iMessage、WebChat 等消息渠道
- **单用户（Single-user）**：面向个人使用的私有助理
- **全平台**：支持 macOS 菜单栏应用、iOS/Android 节点、CLI、Web UI

---

## 二、整体架构

```
消息渠道（WhatsApp / Telegram / Slack / Discord / Signal / WebChat / ...）
                │
                ▼
┌───────────────────────────────────────┐
│           Gateway（网关）              │
│         WebSocket 控制面板             │
│       ws://127.0.0.1:18789            │
│                                       │
│  ┌─────────────────────────────────┐  │
│  │  Channel Manager（通道管理器）    │  │
│  │  Session Manager（会话管理器）    │  │
│  │  Agent Runtime（AI 代理运行时）   │  │
│  │  Tool System（工具系统）         │  │
│  │  Config System（配置系统）       │  │
│  │  Plugin System（插件系统）       │  │
│  │  Cron System（定时任务系统）     │  │
│  │  Auth System（认证系统）         │  │
│  └─────────────────────────────────┘  │
└──────────────┬────────────────────────┘
               │
               ├─ Pi Agent（AI 代理 RPC 模式）
               ├─ CLI（openclaw 命令行）
               ├─ WebChat UI
               ├─ macOS Menu Bar App
               └─ iOS / Android Nodes
```

### 核心设计原则

1. **Gateway 是唯一的控制面板**：所有消息路由、会话管理、工具调用都通过 Gateway 进行
2. **WebSocket 通信**：Gateway 与所有客户端（CLI、App、WebChat）通过 WS 连接
3. **Channel 抽象层**：每个消息渠道（WhatsApp/Telegram 等）都有统一的 Channel 接口
4. **会话隔离**：每个聊天（DM、群组）有独立的 Session，互不影响

---

## 三、核心模块分析

### 3.1 目录结构（`src/`）

| 目录 | 职责 | 复杂度 |
|------|------|--------|
| `src/gateway/` | **核心中枢**：WS 服务器、HTTP 服务、会话管理、认证 | ★★★★★ |
| `src/agents/` | **AI 代理**：模型调用、工具定义、系统 Prompt、上下文管理 | ★★★★★ |
| `src/auto-reply/` | **自动回复**：消息处理、模板、分块、命令解析 | ★★★★ |
| `src/channels/` | **通道抽象层**：Channel 注册、配置、session 映射 | ★★★ |
| `src/config/` | **配置系统**：JSON5 配置、Schema 验证、环境变量 | ★★★★ |
| `src/cli/` | **命令行**：Commander.js 程序、各手动命令 | ★★★ |
| `src/commands/` | **子命令**：gateway、agent、send、onboard 等 | ★★★ |
| `src/plugins/` | **插件系统**：插件加载、注册、运行 | ★★★ |
| `src/infra/` | **基础设施**：日志、端口、环境、二进制管理 | ★★ |
| `src/media/` | **媒体处理**：图片/音频/视频转码、大小限制 | ★★ |
| `src/browser/` | **浏览器控制**：Playwright CDP 控制 Chrome | ★★★ |
| `src/memory/` | **记忆系统**：SQLite 向量存储 | ★★ |
| `src/hooks/` | **钩子系统**：事件钩子 | ★★ |
| `src/cron/` | **定时任务** | ★★ |
| `src/routing/` | **消息路由**：多 agent 路由 | ★★ |
| `src/security/` | **安全性**：沙箱、权限 | ★★ |

### 3.2 各消息渠道目录

| 目录 | 依赖库 |
|------|--------|
| `src/telegram/` | grammY |
| `src/discord/` | discord.js / @buape/carbon |
| `src/slack/` | @slack/bolt |
| `src/signal/` | signal-cli |
| `src/imessage/` | 原生 macOS |
| `src/whatsapp/` | @whiskeysockets/baileys |
| `src/web/` | 内建 WebSocket |

### 3.3 扩展通道（`extensions/`）

通过插件系统扩展，共 38 个扩展，包括：
- `msteams`（Microsoft Teams）
- `matrix`（Matrix 协议）
- `zalo` / `zalouser`
- `bluebubbles`（iMessage 推荐）
- `googlechat`
- `feishu`（飞书）
- `twitch` / `nostr` / `irc` / `line`
- `voice-call`（语音通话）
- `memory-lancedb`（LanceDB 记忆）

---

## 四、核心数据流

### 4.1 消息处理流程

```
1. 用户发送消息 → Channel 接收
2. Channel → Gateway 的 inbound handler
3. Inbound → 解析命令（/status, /new, /think 等）
4. 命令 → 直接处理并返回
5. 普通消息 → Session 查找/创建
6. Session → Agent Runtime（Pi Agent）
7. Agent → 调用 AI 模型（Anthropic/OpenAI/Google 等）
8. AI 回复 → Stream 分块
9. 分块 → 通过 Channel 发送回用户
```

### 4.2 Agent Loop（AI 代理循环）

```
收到用户消息
    │
    ▼
构建 System Prompt（身份 + 工具描述 + Workspace 内容 + Skills）
    │
    ▼
加载 Session History（对话历史）
    │
    ▼
调用 AI Model API（流式）
    │
    ├─ 文本回复 → 分块 → 发送给用户
    │
    └─ Tool Call（工具调用）
        │
        ├─ bash（执行命令）
        ├─ read（读文件）
        ├─ write（写文件）
        ├─ edit（编辑文件）
        ├─ browser（浏览器操作）
        ├─ canvas（可视化画布）
        ├─ cron（定时任务）
        ├─ sessions_*（多 session 协调）
        └─ 自定义工具（plugin/skill 定义）
        │
        ▼
    工具执行结果 → 追加到上下文 → 再次调用 AI → 循环...
```

### 4.3 关键代码入口

| 文件 | 作用 |
|------|------|
| `src/entry.ts` | CLI 入口点，处理 Node.js 启动参数 |
| `src/index.ts` | 模块入口，加载 .env，构建 CLI 程序 |
| `src/cli/program.ts` | Commander.js 命令定义 |
| `src/gateway/server.impl.ts` | **最核心**：Gateway 服务器实现（~785 行） |
| `src/agents/pi-embedded-runner.ts` | AI Agent 嵌入式运行器 |
| `src/agents/system-prompt.ts` | 系统 Prompt 构建 |
| `src/auto-reply/reply.ts` | 自动回复入口 |
| `src/auto-reply/chunk.ts` | 消息分块（适配不同渠道的字数限制） |
| `src/channels/dock.ts` | Channel 注册/管理中心 |

---

## 五、核心系统详解

### 5.1 Gateway 系统

Gateway 是整个 OpenClaw 的**核心中枢**，职责：

1. **WebSocket 服务器**（端口 18789）
   - 接受客户端连接（CLI、macOS App、iOS/Android、WebChat）
   - 基于方法的 RPC 通信协议
   - 支持认证（密码模式 / Tailscale 身份头）

2. **HTTP 服务器**
   - Control UI（Web 管理界面）
   - WebChat 界面
   - OpenAI 兼容 API（Chat Completions + Open Responses）
   - Webhook 接收端

3. **Channel 管理**
   - 启动/停止各消息渠道连接
   - 健康监控
   - 热重载

4. **会话管理**
   - 会话创建/销毁
   - 会话状态持久化（JSONL 文件）
   - 会话隔离（main session vs group sessions）

5. **Node 注册**
   - macOS/iOS/Android 设备注册
   - 远程工具调用路由

### 5.2 Agent 系统

Agent 系统位于 `src/agents/`，是 AI 交互的核心：

#### 模型支持
- **Provider 列表**：Anthropic、OpenAI、Google Gemini、Bedrock、Ollama、Together、Venice、BytePlus/VolcEngine、Moonshot、Minimax、HuggingFace、z.ai 以及更多
- **模型故障转移**（Model Failover）：自动切换到备用模型/认证
- **Auth Profile 轮转**：支持多个 API Key 轮换

#### 核心 Agent 文件
| 文件 | 职责 |
|------|------|
| `system-prompt.ts` | 构建系统 Prompt（~800 行，包含身份、日期时间、工具、技能等） |
| `pi-embedded-runner/` | 嵌入式 Agent 运行器（使用 @mariozechner/pi-agent-core 库） |
| `pi-embedded-subscribe.ts` | 订阅 AI 流式输出、处理 Tool Call |
| `model-selection.ts` | 模型选择逻辑 |
| `model-fallback.ts` | 模型故障转移 |
| `bash-tools.exec.ts` | Bash 命令执行工具实现 |
| `pi-tools.ts` | 所有工具定义的聚合 |
| `compaction.ts` | 上下文压缩（当历史太长时自动摘要） |
| `skills.ts` | Skill 加载和 Prompt 注入 |
| `workspace.ts` | Workspace 文件加载（AGENTS.md, SOUL.md, TOOLS.md） |

#### 工具系统
工具在 `src/agents/tools/` 下定义，主要类别：
- **文件操作**：read、write、edit
- **命令执行**：bash（支持 PTY、Docker sandbox）
- **浏览器**：打开 URL、截图、交互
- **Canvas**：A2UI 可视化画布
- **节点操作**：camera、screen record、location
- **会话管理**：sessions_list、sessions_send、sessions_spawn
- **定时任务**：cron

### 5.3 Session 系统

Session 是对话的核心抽象：

```typescript
// Session 类型
- "main"：主会话（DM 1:1 对话）
- group sessions：群组会话
- subagent sessions：子 Agent 会话
```

**存储结构**：
```
~/.openclaw/
├── openclaw.json          # 全局配置
├── credentials/           # 渠道凭证
├── sessions/              # Session 数据（JSONL）
├── workspace/             # Agent 工作空间
│   ├── AGENTS.md          # Agent 人格指令
│   ├── SOUL.md            # AI 灵魂/性格
│   ├── TOOLS.md           # 工具说明
│   └── skills/            # 技能目录
│       └── <skill>/SKILL.md
└── agents/                # Agent 数据
    └── <agentId>/
        └── sessions/*.jsonl
```

### 5.4 配置系统

配置位于 `~/.openclaw/openclaw.json`（JSON5 格式），关键配置块：

```json5
{
  // AI 模型配置
  agent: {
    model: "anthropic/claude-opus-4-6",
    thinkingLevel: "medium",
  },
  // Agent 默认值
  agents: {
    defaults: {
      workspace: "~/.openclaw/workspace",
      sandbox: { mode: "non-main" },
    },
  },
  // 各消息渠道配置
  channels: {
    whatsapp: { allowFrom: [...] },
    telegram: { botToken: "..." },
    discord: { token: "..." },
    slack: { botToken: "...", appToken: "..." },
  },
  // Gateway 配置
  gateway: {
    port: 18789,
    bind: "loopback",
    auth: { mode: "password", password: "..." },
  },
  // 工具配置
  tools: { allow: [...], deny: [...] },
  // 浏览器控制
  browser: { enabled: true },
}
```

配置系统特点：
- **TypeBox Schema** 严格类型校验
- **Zod Schema** 运行时验证
- **环境变量替换**：支持 `${ENV_VAR}` 语法
- **配置继承/合并**：`includes` 字段支持配置文件引用
- **热重载**：Gateway 运行时可以重新加载配置

### 5.5 Plugin 系统

```
extensions/
├── bluebubbles/      # iMessage 通过 BlueBubbles
├── msteams/          # Microsoft Teams
├── matrix/           # Matrix 协议
├── googlechat/       # Google Chat
├── feishu/           # 飞书
├── voice-call/       # 语音通话（ElevenLabs TTS）
├── memory-lancedb/   # LanceDB 向量记忆
├── open-prose/       # 开放散文（长文本处理）
└── ... (38 个扩展包)
```

插件通过 `openclaw/plugin-sdk` 开发，运行于独立 `package.json` 的 workspace 包。

### 5.6 通信协议

Gateway WS 协议基于 **JSON-RPC 风格**的方法调用：

```typescript
// 客户端 → Gateway
{ method: "chat.send", params: { sessionKey, message, ... } }
{ method: "sessions.list", params: {} }
{ method: "sessions.patch", params: { sessionKey, ... } }
{ method: "config.get", params: {} }
{ method: "node.invoke", params: { nodeId, action, ... } }

// Gateway → 客户端（事件广播）
{ event: "chat.message", data: { sessionKey, text, ... } }
{ event: "chat.typing", data: { sessionKey, ... } }
{ event: "agent.tool_call", data: { ... } }
{ event: "update.available", data: { version, ... } }
```

---

## 六、技术栈

| 层面 | 技术 |
|------|------|
| 语言 | TypeScript (ESM) |
| 运行时 | Node.js 22+（也支持 Bun） |
| 包管理 | pnpm |
| 构建 | tsdown（基于 esbuild） |
| AI SDK | @mariozechner/pi-agent-core（嵌入式 AI 代理核心库） |
| HTTP | Express 5 |
| WebSocket | ws |
| CLI | Commander.js |
| 类型校验 | @sinclair/typebox + Zod |
| 测试 | Vitest |
| 格式化/Lint | Oxfmt + Oxlint |
| 浏览器控制 | Playwright Core |
| 媒体处理 | sharp (图片) |
| 数据库 | SQLite (sqlite-vec 向量扩展) |
| macOS/iOS | SwiftUI |
| Android | Kotlin |

---

## 七、为你的简易版本提供的设计建议

基于对 OpenClaw 的分析，如果你要做一个**简易版本的 AI 助理**，以下是核心模块和可精简的方向：

### ✅ 必须保留的核心

| 模块 | 原因 |
|------|------|
| **Gateway WS 服务器** | 客户端通信的基础 |
| **Agent Runtime** | AI 模型调用 + Tool use 循环 |
| **Session 管理** | 对话历史和上下文 |
| **配置系统** | 存储 API Key 和设置 |
| **至少 1 个 Channel** | 用于接收/发送消息（建议 WebChat 或 Telegram） |

### ❌ 可以精简/去掉的

| 模块 | 原因 |
|------|------|
| 大量 Channel 集成 | 保留 1-2 个即可 |
| 38 个 extensions | 除非有具体需求 |
| macOS/iOS/Android 原生 App | 可以只用 WebChat |
| Voice Wake / Talk Mode | 语音功能 |
| Canvas / A2UI | 可视化画布 |
| Tailscale 集成 | 本地使用不需要 |
| Docker 沙箱 | 简化安全模型 |
| 模型故障转移 | 简易版用单一模型即可 |
| 复杂的 Skill 系统 | 简化为直接的 Prompt 注入 |
| 插件系统 | 如果功能固定则不需要 |
| 多 Agent 路由 | 简易版单 Agent 足够 |
| Sub-agent 系统 | 高级功能 |
| Cron 系统 | 除非需要定时任务 |
| 记忆系统 | 可以后续增加 |
| 浏览器控制 | 可以后续增加 |

### 🎯 最小可行架构

```
┌─────────────────────────────┐
│        简易 Gateway          │
│     (Express + WS 服务器)    │
│                             │
│  ┌──────────────────────┐   │
│  │  Config Loader       │   │  ← 加载 JSON 配置 + API Key
│  │  Session Store       │   │  ← JSONL 文件存储对话历史
│  │  Agent Runner        │   │  ← 调用 AI API + 工具循环
│  │  Tool System         │   │  ← bash / read / write
│  │  WebChat Channel     │   │  ← Web UI 消息收发
│  └──────────────────────┘   │
│                             │
│  [可选] Telegram Channel    │
│  [可选] 其他 Channel        │
└─────────────────────────────┘
```

### 📏 代码量估算

| 模块 | OpenClaw 代码量 | 简易版估算 |
|------|----------------|-----------|
| Gateway 服务器 | ~800 行 | ~200 行 |
| Agent Runtime | ~2000 行 | ~500 行 |
| Session 管理 | ~500 行 | ~150 行 |
| 工具系统 | ~3000 行 | ~300 行（bash + read + write） |
| 配置 | ~2000 行 | ~100 行 |
| WebChat Channel | ~500 行 | ~200 行 |
| CLI | ~1000 行 | ~100 行 |
| **总计** | **~50000+ 行** | **~1500-2000 行** |

---

## 八、关键依赖库参考

如果你要复用部分能力，以下库值得关注：

| 库 | 用途 | 是否推荐简易版使用 |
|---|------|---------|
| `@mariozechner/pi-agent-core` | AI Agent 核心运行库 | ⚠️ 可选，可以直接调用 API |
| `express` | HTTP 服务器 | ✅ |
| `ws` | WebSocket | ✅ |
| `commander` | CLI | ✅ 可选 |
| `json5` | JSON5 配置解析 | ✅ |
| `grammy` | Telegram Bot | ✅ 如需 Telegram |
| `sharp` | 图片处理 | ⚠️ 可选 |
| `playwright-core` | 浏览器控制 | ⚠️ 可选 |

---

## 总结

OpenClaw 是一个**功能极其完善但体量庞大**的个人 AI 助理平台。它的核心设计理念是正确的：
1. **Gateway 作为中心化控制面板**
2. **Channel 抽象层解耦消息渠道**
3. **Session 隔离保证对话独立性**
4. **Agent Loop 实现 AI + 工具的循环调用**

但对于简易版本，你只需要抽取上述 4 个核心概念，去掉大量的渠道集成、平台适配、安全防护和运维功能，即可得到一个**轻量但核心能力完整**的 AI 助理。
