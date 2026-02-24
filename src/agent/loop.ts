import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { toolDefinitions, executeTool } from "../tools/index.js";
import { memoryToolDefinitions, executeMemoryTool, getRecentMemories } from "../memory/index.js";
import { cronToolDefinitions, executeCronTool } from "../cron/manager.js";
import { clawHubToolDefinitions, executeClawHubTool } from "../skills/clawhub.js";
import { getSession, appendMessage, appendMessages } from "./session.js";
import { loadSkills, reloadSkills, buildSkillsPrompt, type Skill } from "../skills/loader.js";

// ==================== ReAct 循环引擎 ====================

const MAX_LOOP_ITERATIONS = 15; // 最大循环次数（防止死循环）

let client: OpenAI;
let skills: Skill[] = [];

/**
 * 初始化 Agent（创建 OpenAI 兼容客户端 + 加载 Skills）
 */
export function initAgent(): void {
  const apiKey = process.env.SILICONFLOW_API_KEY;
  const baseURL = process.env.SILICONFLOW_BASE_URL || "https://api.siliconflow.cn/v1";

  if (!apiKey) {
    throw new Error("缺少 SILICONFLOW_API_KEY 环境变量");
  }

  client = new OpenAI({ apiKey, baseURL });
  skills = loadSkills();

  console.log("[Agent] 初始化完成");
  console.log(`[Agent] 模型: ${process.env.SILICONFLOW_MODEL || "deepseek-ai/DeepSeek-V3"}`);
  console.log(`[Agent] 工具数: ${getAllTools().length}`);
}

/**
 * 构建 System Prompt
 */
function buildSystemPrompt(userId: string): string {
  const name = process.env.ASSISTANT_NAME || "AI 助理";
  const now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });

  let prompt = `你是${name}，一个智能且高效的个人 AI 助理。

## 基本规则
- 当前北京时间: ${now}
- 你运行在用户的个人服务器上，拥有终端执行和文件读写能力。
- 你可以主动使用工具来完成任务，不需要反复确认。
- 回复尽量简洁精炼，微信消息不宜过长。
- 如果用户告诉你重要的个人信息，使用 save_memory 工具记住它。
- 对于复杂任务，先思考步骤，再逐步执行。

## 工具使用指南
- bash_execute: 执行终端命令（查看文件、运行脚本、安装软件等）
- read_file / write_file / edit_file: 读写编辑本地文件
- save_memory / search_memory: 长期记忆的存取
- add_cron_job / list_cron_jobs / remove_cron_job: 管理定时任务
- clawhub_search / clawhub_install / clawhub_list / clawhub_update: 技能商店（搜索/安装/列出/更新技能）

## 技能商店 (ClawHub)
你可以通过 clawhub 工具从在线技能商店搜索和安装新能力。
- 当你觉得自己缺少某个领域的能力时，主动使用 clawhub_search 搜索。
- 当用户询问「你能不能做 XXX」而你当前技能不支持时，先去商店搜搜看。
- 安装后新技能会在下一轮对话自动生效。`;

  // 注入 Skills
  const skillsPrompt = buildSkillsPrompt(skills);
  if (skillsPrompt) prompt += skillsPrompt;

  // 注入用户的长期记忆
  const memories = getRecentMemories(userId);
  if (memories) {
    prompt += `\n\n## 关于该用户的已知信息\n${memories}`;
  }

  return prompt;
}

/**
 * 获取所有工具定义
 */
function getAllTools(): ChatCompletionTool[] {
  return [...toolDefinitions, ...memoryToolDefinitions, ...cronToolDefinitions, ...clawHubToolDefinitions];
}

/**
 * 统一的工具执行路由
 */
async function routeToolExecution(
  toolName: string,
  args: Record<string, any>,
  userId: string,
): Promise<string> {
  // 记忆工具
  if (["save_memory", "search_memory", "delete_memory"].includes(toolName)) {
    return executeMemoryTool(toolName, args, userId);
  }
  // Cron 工具
  if (["add_cron_job", "list_cron_jobs", "remove_cron_job"].includes(toolName)) {
    return executeCronTool(toolName, args, userId);
  }
  // ClawHub 技能商店工具
  if (["clawhub_search", "clawhub_install", "clawhub_list", "clawhub_update"].includes(toolName)) {
    const result = await executeClawHubTool(toolName, args);
    // 如果安装了新技能，热重载 Skills
    if (toolName === "clawhub_install" && result.includes("安装成功")) {
      skills = reloadSkills();
    }
    return result;
  }
  // 文件/命令工具
  return executeTool(toolName, args);
}

/**
 * 核心 ReAct 循环
 *
 * 这是整个系统的心脏：
 *   1. 构建上下文 (System Prompt + 历史 + 用户消息)
 *   2. 调用大模型
 *   3. 检查是否有 tool_calls
 *   4. 如果有 → 执行工具 → 结果注入上下文 → 回到步骤 2
 *   5. 如果没有 → 返回最终文本回复
 */
export async function runAgentLoop(
  userId: string,
  userMessage: string,
): Promise<string> {
  const model = process.env.SILICONFLOW_MODEL || "deepseek-ai/DeepSeek-V3";
  const systemPrompt = buildSystemPrompt(userId);

  // 获取历史上下文
  const history = getSession(userId);

  // 如果是新会话（没有 system 消息），加入 system prompt
  if (history.length === 0 || history[0].role !== "system") {
    appendMessage(userId, { role: "system", content: systemPrompt });
  } else {
    // 更新 system prompt（可能记忆/时间变了）
    history[0] = { role: "system", content: systemPrompt };
  }

  // 追加用户消息
  appendMessage(userId, { role: "user", content: userMessage });

  const allTools = getAllTools();
  let iterations = 0;

  while (iterations < MAX_LOOP_ITERATIONS) {
    iterations++;
    const currentMessages = getSession(userId);

    console.log(`[Agent] 循环第 ${iterations} 轮，消息数: ${currentMessages.length}`);

    try {
      const response = await client.chat.completions.create({
        model,
        messages: currentMessages,
        tools: allTools.length > 0 ? allTools : undefined,
        temperature: 0.7,
        max_tokens: 4096,
      });

      const choice = response.choices[0];
      if (!choice) {
        return "AI 返回了空响应，请重试。";
      }

      const assistantMessage = choice.message;

      // 将 assistant 回复追加到 session
      appendMessage(userId, assistantMessage as ChatCompletionMessageParam);

      // 检查是否有工具调用
      if (
        choice.finish_reason === "tool_calls" ||
        (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0)
      ) {
        const toolCalls = assistantMessage.tool_calls!;
        console.log(`[Agent] 发起 ${toolCalls.length} 个工具调用`);

        // 并行执行所有工具调用
        const toolResults = await Promise.all(
          toolCalls.map(async (tc) => {
            let args: Record<string, any> = {};
            try {
              args = JSON.parse(tc.function.arguments);
            } catch {
              args = {};
            }

            const result = await routeToolExecution(tc.function.name, args, userId);
            console.log(`[Agent] 工具 ${tc.function.name} 执行完毕 (${result.length} 字符)`);

            return {
              role: "tool" as const,
              tool_call_id: tc.id,
              content: result,
            };
          }),
        );

        // 工具结果注入上下文
        appendMessages(userId, toolResults);

        // 继续下一轮循环（让大模型消化工具结果）
        continue;
      }

      // 没有工具调用 = 大功告成，返回最终文本
      const finalText = assistantMessage.content || "(AI 未返回文本内容)";
      console.log(`[Agent] 循环结束，共 ${iterations} 轮`);
      return finalText;
    } catch (error: any) {
      console.error("[Agent] API 调用出错:", error.message || error);
      return `AI 处理出错: ${error.message || "未知错误"}，请稍后重试。`;
    }
  }

  return `⚠️ AI 执行了 ${MAX_LOOP_ITERATIONS} 轮工具调用仍未完成，已强制停止。请尝试简化你的请求。`;
}
