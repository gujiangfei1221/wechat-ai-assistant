# 🤖 微信 AI 助理 (WeChat AI Assistant)

一个精简版、本地优先的个人 AI 助理，通过微信测试号与你对话，拥有终端执行和文件读写能力。

## ✨ 核心特性

- **ReAct Agent 引擎**：基于硅基流动 (SiliconFlow) 兼容 OpenAI 协议的大模型驱动
- **本地工具集**：终端命令执行 (bash)、文件读写 (fs)，让 AI 拥有操作服务器的能力
- **长期记忆 (Memory)**：基于 SQLite 的持久化记忆系统，AI 会记住你的偏好和背景
- **技能系统 (Skills)**：通过 Markdown 文件动态加载 AI 的专项能力，随时扩展
- **定时任务 (Cron)**：AI 可以自主注册定时任务，主动推送提醒到微信
- **异步处理**：巧妙绕过微信 5 秒超时限制，让 AI 有充分时间思考和执行

## 📋 系统要求

- Node.js 20+
- 微信公众平台测试号
- 硅基流动 API Key ([申请地址](https://cloud.siliconflow.cn))

## 🚀 快速开始

### 1. 安装依赖
```bash
cd wechat-ai-assistant
npm install
```

### 2. 配置环境变量
```bash
cp .env.example .env
# 编辑 .env，填入你的 API Key 和微信测试号配置
```

`.env` 关键配置：
```env
SILICONFLOW_API_KEY=sk-xxxx        # 硅基流动 API Key
SILICONFLOW_MODEL=deepseek-ai/DeepSeek-V3  # 推荐模型
WECHAT_APP_ID=wxxxxxxxxxxx          # 微信测试号 AppID
WECHAT_APP_SECRET=xxxxxxxxxxxxxxxx  # 微信测试号 AppSecret
WECHAT_TOKEN=your_custom_token      # 自定义 Token（和微信后台保持一致）
```

### 3. 启动服务
```bash
npm run dev
```

### 4. 暴露到公网
```bash
# 新开一个终端
npx localtunnel --port 3000
# 或者使用 ngrok
ngrok http 3000
```

### 5. 配置微信测试号
1. 登录 [微信公众平台测试号管理页](https://mp.weixin.qq.com/debug/cgi-bin/sandbox?t=sandbox/login)
2. 在"接口配置信息"中填入：
   - URL: `https://你的公网地址/wechat`
   - Token: 与 `.env` 中的 `WECHAT_TOKEN` 一致
3. 点击"提交"验证通过即可

### 6. 开始对话
用微信扫描测试号的二维码关注后，直接发消息即可！

## 📁 项目结构

```
wechat-ai-assistant/
├── src/
│   ├── server.ts          # 主入口：Express + 微信 Webhook
│   ├── agent/
│   │   ├── loop.ts        # 🧠 ReAct 循环引擎（核心！）
│   │   └── session.ts     # 会话历史管理
│   ├── tools/
│   │   ├── index.ts       # 工具注册中心 + JSON Schema
│   │   ├── bash.ts        # 终端命令执行
│   │   └── fs.ts          # 文件读写操作
│   ├── wechat/
│   │   ├── api.ts         # 微信客服消息 API
│   │   └── xml.ts         # XML 解析/构建
│   ├── memory/
│   │   └── index.ts       # SQLite 长期记忆
│   ├── skills/
│   │   └── loader.ts      # Markdown 技能加载器
│   └── cron/
│       └── manager.ts     # 定时任务管理器
├── workspace/
│   └── skills/            # 放置你的自定义 Skill
│       ├── code-review.md
│       └── morning-greeting.md
├── package.json
├── tsconfig.json
└── .env.example
```

## 🔧 自定义 Skill

在 `workspace/skills/` 目录下创建 `.md` 文件即可：

```markdown
---
description: 你的技能描述
---
这里写 System Prompt 注入内容...
```

重启服务后自动生效。

## ⚠️ 安全提示

此项目设计为**纯个人使用**。bash 工具拥有完整的 shell 权限，请勿暴露给不信任的用户。
