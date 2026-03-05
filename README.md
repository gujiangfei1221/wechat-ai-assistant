# 🤖 WeClaw

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
cd weclaw
npm install
```

### 2. 配置环境变量
```bash
cp .env.example .env
# 编辑 .env，填入你的 API Key 和微信测试号配置
```

`.env` 关键配置：

#### 选择 AI 模型提供商

**方案一：硅基流动（默认）**
```env
AI_PROVIDER=siliconflow
SILICONFLOW_API_KEY=sk-xxxx        # 硅基流动 API Key
SILICONFLOW_MODEL=deepseek-ai/DeepSeek-V3  # 推荐模型
```

**方案二：阿里云百炼**
```env
AI_PROVIDER=bailian
BAILIAN_API_KEY=sk-xxxx            # 百炼 API Key
BAILIAN_MODEL=qwen3.5-plus         # 推荐模型
```

支持的百炼模型：
- `qwen3.5-plus` - 通义千问 3.5 Plus（推荐，推理能力强）
- `qwen3-max-2026-01-23` - 通义千问 3 Max
- `qwen3-coder-next` / `qwen3-coder-plus` - 代码专用模型
- `MiniMax-M2.5` - MiniMax 模型
- `glm-5` / `glm-4.7` - 智谱 GLM 系列
- `kimi-k2.5` - Kimi 模型

#### 微信配置
```env
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
weclaw/
├── src/                   # 源代码
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
│   │   ├── loader.ts      # Markdown 技能加载器
│   │   └── clawhub.ts     # ClawHub 技能商店集成
│   └── cron/
│       └── manager.ts     # 定时任务管理器
├── config/                # 配置文件
│   └── skills/            # 技能定义文件
│       ├── code-review.md
│       ├── morning-greeting.md
│       └── ...
├── data/                  # 运行时数据（已加入 .gitignore）
│   └── memory.db          # SQLite 数据库
├── scripts/               # 工具脚本
│   ├── ticktick/          # TickTick 相关脚本
│   ├── a-share-investor/  # A股投资相关脚本
│   └── ...
├── devops/                # 部署脚本
│   ├── deploy.sh
│   └── logs.sh
├── dist/                  # 编译输出
├── package.json
├── tsconfig.json
└── .env.example
```

## 🔧 自定义 Skill

在 `config/skills/` 目录下创建 `.md` 文件即可：

```markdown
---
description: 你的技能描述
---
这里写 System Prompt 注入内容...
```

重启服务后自动生效。

## ✅ TickTick（滴答清单）技能配置

项目内已内置 `ticktick-manager` 技能，可直接调用 Dida365 OpenAPI 管理任务。

### 1) 配置 `.env`

```env
TICKTICK_BASE_URL=https://api.dida365.com/open/v1
TICKTICK_ACCESS_TOKEN=
TICKTICK_CLIENT_ID=
TICKTICK_CLIENT_SECRET=
TICKTICK_REDIRECT_URI=
TICKTICK_REFRESH_TOKEN=
TICKTICK_OAUTH_BASE_URL=https://dida365.com
```

### 2) 首次获取 Access Token

运行：

```bash
python3 scripts/ticktick/oauth_get_token.py \
  --client-id "你的ClientID" \
  --client-secret "你的ClientSecret" \
  --redirect-uri "你的RedirectURI"
```

脚本会输出授权 URL，浏览器授权后粘贴 `code`，即可拿到 `access_token`（若平台返回也会包含 `refresh_token`）。

### 3) 验证 API 是否可用

```bash
python3 scripts/ticktick/ticktick_api.py list-projects
```

正常会返回项目 JSON 列表。

### 4) 常用命令

```bash
# 列出项目
python3 scripts/ticktick/ticktick_api.py list-projects

# 列出项目任务
python3 scripts/ticktick/ticktick_api.py list-tasks --project-id <projectId>

# 创建任务
python3 scripts/ticktick/ticktick_api.py create-task --project-id <projectId> --title "任务标题"

# 更新任务
python3 scripts/ticktick/ticktick_api.py update-task --task-id <taskId> --title "新标题"

# 完成任务
python3 scripts/ticktick/ticktick_api.py complete-task --project-id <projectId> --task-id <taskId>

# 删除任务
python3 scripts/ticktick/ticktick_api.py delete-task --project-id <projectId> --task-id <taskId>
```

### 5) 刷新 Token（可自动回写 `.env`）

```bash
# 仅刷新并打印
python3 scripts/ticktick/oauth_refresh_token.py

# 刷新并自动写回 .env
python3 scripts/ticktick/oauth_refresh_token.py --write-env
```

## ⚠️ 安全提示

此项目设计为**纯个人使用**。bash 工具拥有完整的 shell 权限，请勿暴露给不信任的用户。
