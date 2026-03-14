---
name: vidnote-summary
description: "视频总结：用户发送视频链接（B站、小红书、抖音、YouTube 等），自动下载、转录、AI 总结，生成结构化笔记。当用户分享视频链接并要求总结时触发。"
metadata: { "openclaw": { "emoji": "🎬" } }
---

# 视频总结技能

使用本地部署的 VidNote CLI 工具，对视频进行下载、语音转录和 AI 知识萃取。

## VidNote CLI 路径

根据运行环境选择对应的 CLI 目录（位于本技能目录下）：
- **macOS (本地开发)**：`config/skills/vidnote-summary/mac-arm64/vidnote-cli/`
- **Linux (服务器)**：`config/skills/vidnote-summary/linux-x64/vidnote-cli/`

## When to Use

✅ **USE this skill when:**

- 用户发送了视频链接（包含 bilibili.com、xiaohongshu.com、douyin.com、youtube.com、b23.tv 等视频平台域名）
- 用户说"帮我总结这个视频"、"看看这个视频讲了什么"、"视频笔记"
- 用户说"下载这个视频"

## When NOT to Use

❌ **DON'T use this skill when:**

- 用户发送的是文章链接（非视频） → 使用 summarize 技能
- 用户只是提到视频但没有给出链接

## 使用流程

设定变量（根据当前操作系统选择）：
- macOS: `CLI_DIR=config/skills/vidnote-summary/mac-arm64/vidnote-cli`，`CLI_BIN=./api_backend`
- Linux: `CLI_DIR=config/skills/vidnote-summary/linux-x64/vidnote-cli`，`CLI_BIN=./vidnote`

### 第 1 步：获取视频信息（快速确认链接有效）

```bash
cd $CLI_DIR && $CLI_BIN info '<视频链接>' --json 2>&1
```

注意：URL 必须用**单引号**包裹（防止特殊字符被 shell 解析）。

解析返回的 JSON，向用户确认：
> 🎬 **视频信息**
> - 标题：{title}
> - 时长：{duration} 秒
> - 正在为你处理，请稍候...

**如果视频时长超过 1800 秒（30 分钟）**，先提醒用户处理时间可能较长（预计 5-10 分钟）。

### 第 2 步：完整处理（下载 → 转录 → AI 总结）

```bash
cd $CLI_DIR && $CLI_BIN process '<视频链接>' --json -o ./output 2>&1
```

⚠️ **注意**：此命令执行时间较长（通常 1-3 分钟），取决于视频时长。

### 第 3 步：解析结果并回复用户

`--json` 模式的输出格式（JSON 在 stdout 最后一行）：

```json
{
  "success": true,
  "elapsed": 66.9,
  "md_path": "/path/to/output/xxx_总结.md",
  "summary": "## 核心主题\n...",
  "transcript": "完整转录文本...",
  "keyframes": [
    {"time": "00:01:23", "title": "...", "summary": "..."}
  ]
}
```

将 `summary` 字段的内容格式化后回复用户。回复格式：

> 🎬 **视频总结：{视频标题}**
>
> {summary 内容}
>
> 📸 **关键时刻：**
> - ⏱️ {time} — {title}：{summary}
> - ...
>
> ⏱️ 处理耗时：{elapsed} 秒

### 第 4 步：保存到备忘录（自动）

处理完成后，自动将视频总结保存到备忘录（使用 memo-manager 技能）：
- type: `note`
- title: `视频总结：{视频标题}`
- tags: [视频总结, {平台名}]
- 正文包含完整的 summary 内容和视频链接

### 第 5 步：清理临时文件（必须执行）

总结保存成功后，**立即清理** output 目录中的大文件，防止磁盘被撑满：

```bash
cd $CLI_DIR && rm -rf ./output/*.mp4 ./output/*.wav ./output/*_screenshots/ 2>/dev/null; echo "cleaned"
```

⚠️ 只删除视频、音频和截图，保留 `.md` 总结文件和 `.txt` 转录文件以备后续查阅。

## 错误处理

- 如果 `info` 命令失败，提示用户检查链接是否正确
- 如果 `process` 命令超时或失败，告诉用户具体错误信息，建议稍后重试
- 如果返回 JSON 中 `success` 为 `false`，展示 `error` 字段的错误信息

## 注意事项

- 执行命令时必须先 `cd` 到 CLI 目录，确保程序能找到同目录下的 .env 和依赖文件
- 输出目录使用 `./output`，文件会保存在 CLI 目录下的 output/ 子目录
- 小红书等平台的链接可能包含特殊字符（`&`、`=`），**必须用单引号包裹 URL**
