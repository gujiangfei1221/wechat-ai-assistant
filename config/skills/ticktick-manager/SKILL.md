---
name: ticktick-manager
description: "Manage TickTick (Dida365) tasks and projects via OpenAPI. Use when user asks to create/list/update/complete tasks, manage projects, or sync task status with TickTick. OAuth is fully automated."
metadata: { "openclaw": { "emoji": "✅", "requires": { "bins": ["curl"] } } }
---

# TickTick Manager Skill

通过 bash_execute + curl 调用滴答清单 (Dida365) OpenAPI 管理任务。
OAuth Token 全自动管理——**用户只需配置 CLIENT_ID 和 CLIENT_SECRET，首次使用点击一下授权链接即可**。

## Prerequisites

用户只需配置两项：

```
/set TICKTICK.CLIENT_ID=你的client_id
/set TICKTICK.CLIENT_SECRET=你的client_secret
```

> 在滴答清单开发者后台，把 OAuth 回调地址填写为：`{SERVER_URL}/ticktick/callback`
> （`SERVER_URL` 是你在 .env 里配置的服务器地址，例如 `https://your-domain.com`）

**⚠️ 关键说明：技能文档不是工具！**

使用 `bash_execute` 工具执行 curl 命令。`ticktick_get_token` 是可以直接调用的工具。

## When to Use

✅ **USE this skill when:**

- "我今天有什么任务"、"今日待办"
- "帮我创建/添加一个任务"
- "完成/删除/更新某个任务"
- "列出我的项目"
- 晨间问候需要获取待办信息时

## When NOT to Use

❌ **DON'T use this skill when:**

- 用户只是口头提到任务但无操作意图
- 备忘录类型的记录（应使用 memo-manager 技能）

## First-time Setup Guide（首次使用引导）

**每次使用滴答清单功能前必须先调用 `ticktick_get_token`。**

根据返回值第一行的前缀，分三种情况处理：

---

### 情况 1：第一行是 `SETUP_REQUIRED`（配置不完整）

第二行 `MISSING:` 列出了缺少哪些配置，第三行 `CURRENT_REDIRECT_URI:` 是当前回调地址。
AI 应按以下步骤**逐步引导**用户完成配置，**不要一次性把所有步骤都列出来**，防止用户看懵：

**① 如果 `MISSING` 含 `TICKTICK.REDIRECT_URI`**（回调地址是 localhost，生产环境不可用），先让用户配置回调地址：

> 我需要知道你的服务器域名，才能帮你完成滴答清单授权。
> 请把你的服务器域名告诉我（例如 `https://your-domain.com`），我来生成正确的回调地址。

用户告知域名后，让用户发送：
```
/set TICKTICK.REDIRECT_URI=https://用户域名/ticktick/callback
```

**② 如果 `MISSING` 含 `TICKTICK.CLIENT_ID` 或 `TICKTICK.CLIENT_SECRET`**，引导创建应用：

> 📋 初次使用滴答清单，需要完成一次性配置：
>
> **第一步：创建开发者应用**
> 访问 👉 https://developer.dida365.com，登录后点击「创建应用」
> 在「回调地址（Redirect URI）」处填写：`{CURRENT_REDIRECT_URI 的值}`
>
> **第二步：把凭证发给我**（可一次性发送两行）：
> ```
> /set TICKTICK.CLIENT_ID=你的client_id
> /set TICKTICK.CLIENT_SECRET=你的client_secret
> ```
> 配置完成后再说一次你的请求即可。

---

### 情况 2：第一行是 `AUTH_REQUIRED`（已配置，需首次授权）

- 第二行 `OAUTH_URL:` 后面是**授权链接**（以 `https://dida365.com` 开头）
- 第三行 `CALLBACK_URL:` 后面是回调地址（不要展示给用户）

AI 应发给用户 **`OAUTH_URL:` 后面的完整 URL**：

> 🔗 配置已就绪！请在浏览器打开以下授权链接，点击「允许」：
> `{OAUTH_URL 的值}`
> 授权后我会收到通知，自动帮你查询任务，无需其他操作。

---

### 情况 3：其他内容（有效 token）

直接使用该值调用 API，无需展示给用户。

---

## Core Rules

- **每次调用 API 前必须先调用 `ticktick_get_token` 获取有效 token**
- 不要在输出中打印 token 明文，用 `***` 脱敏
- If API returns 401, call `ticktick_get_token` again
- 所有 curl 请求加 `--max-time 10` 超时限制

## API Base URL

```
https://api.dida365.com/open/v1
```

## Standard Workflow（标准流程）

### 第一步：调用 ticktick_get_token 获取 token

```
ticktick_get_token()
```

**处理返回值：**

| 返回内容 | 含义 | AI 的处理方式 |
|----------|------|--------------|
| 以 `AUTH_REQUIRED` 开头 | 首次使用，需要授权 | 把第二行的授权 URL 发给用户："请点击此链接完成授权，授权后我会自动继续" |
| 以 `❌` 开头 | 未配置 CLIENT_ID/SECRET | 把错误信息转告用户 |
| 其他（token 字符串） | 有效 token | 直接使用 |

> **首次授权说明**：用户点击授权链接 → 浏览器跳转 → 服务器自动捕获 code → 换取 token → 微信推送"授权成功"通知。
> **用户无需手动复制任何内容**，等待微信通知即可。

### 第二步：调用 API

把第一步获得的 token 代入 `<TOKEN>` 位置。

#### 📋 查询任务的标准策略

当用户问"今天有什么任务"、"我的待办"等，**用一次 bash_execute 批量查询所有项目的任务**：

```bash
TOKEN="<TOKEN>"
API="https://api.dida365.com/open/v1"

# 1. 获取所有项目
echo "=== PROJECTS ==="
PROJECTS=$(curl -s --max-time 15 -H "Authorization: Bearer $TOKEN" "$API/project")
echo "$PROJECTS"

# 2. 提取所有 projectId（兼容 "id": "xxx" 和 "id":"xxx" 两种格式）
IDS=$(echo "$PROJECTS" | grep -oE '"id"\s*:\s*"[^"]*"' | grep -oE '"[^"]*"$' | tr -d '"')

# 3. 逐个获取任务（用 for 循环，不用管道）
for pid in $IDS; do
  echo ""
  echo "=== TASKS_FOR_PROJECT: $pid ==="
  curl -s --max-time 15 -H "Authorization: Bearer $TOKEN" "$API/project/$pid/data"
done
```

> ⚠️ **必须用这个批量脚本**，不要一个项目一个项目地分开调用 bash_execute，否则会浪费循环轮次且容易漏掉项目。

**数据过滤与汇总规则：**

- **默认范围**：所有项目的所有未完成任务（`tasks` 数组中的即为未完成）
- **收集箱**：也是一个项目，通常 `name` 为 "收集箱" 或 "Inbox"，**不要跳过它**
- **用户指定范围**：如果用户说"帮我看看工作项目的任务"，只展示 name 匹配的项目
- **今日过滤**：用户问"今天"的任务，按 `dueDate` 过滤出今天及已过期的未完成任务；无 `dueDate` 的任务也展示（属于"随时可做"）
- **不限数量**：把所有匹配的任务全部展示
- **分组展示**：按项目名分组，格式参考：

```
📋 你共有 X 个待办：

📥 收集箱
  • 预约牙医
  • 买生日礼物（截止明天）

📁 工作
  • 写周报（截止今天，🔴 高优先级）
  • 回复客户邮件
```

#### 其他 API 操作

```bash
# 创建任务
curl -s --max-time 10 -X POST \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"title":"<任务标题>","projectId":"<projectId>","dueDate":"<ISO8601日期>"}' \
  "https://api.dida365.com/open/v1/task"

# 完成任务
curl -s --max-time 10 -X POST \
  -H "Authorization: Bearer <TOKEN>" \
  "https://api.dida365.com/open/v1/project/<projectId>/task/<taskId>/complete"

# 删除任务
curl -s --max-time 10 -X DELETE \
  -H "Authorization: Bearer <TOKEN>" \
  "https://api.dida365.com/open/v1/project/<projectId>/task/<taskId>"

# 更新任务
curl -s --max-time 10 -X POST \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"title":"<新标题>","dueDate":"<新日期>","priority":<0-5>}' \
  "https://api.dida365.com/open/v1/task/<taskId>"
```

## Token 生命周期（全自动）

| Token 状态 | ticktick_get_token 行为 |
|------------|------------------------|
| 有效（剩余 > 7 天）| 直接返回 |
| 快过期（剩余 ≤ 7 天）| 自动用 refresh_token 续期再返回 |
| 续期失败 / 从未授权 | 返回 AUTH_REQUIRED + 授权 URL |

## Error Handling

- `401 Unauthorized`: 调用 `ticktick_get_token` 重新获取，可能触发重新授权
- `403 Forbidden`: 应用缺少 tasks:write / tasks:read scope
- `404 Not Found`: projectId / taskId 无效，先查项目列表确认
- `429 Too Many Requests`: 等待后重试
- **超时/连接失败**: 跳过，告知用户稍后再试，不要反复重试

## References

- API notes: `references/openapi-notes.md`
- Official docs: https://developer.dida365.com/docs#/openapi
