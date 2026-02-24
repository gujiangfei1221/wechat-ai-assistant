import cron from "node-cron";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

// ==================== Cron 定时任务管理器 ====================

interface CronJob {
  id: string;
  expression: string;
  description: string;
  userId: string;
  prompt: string; // AI 要执行的指令
  task: cron.ScheduledTask;
  createdAt: string;
}

const jobs = new Map<string, CronJob>();
let nextId = 1;

// 用于存放外部回调，由 server.ts 注入
let onCronTrigger: ((userId: string, prompt: string) => Promise<void>) | null = null;

/**
 * 注册 Cron 触发时的回调函数
 */
export function setCronTriggerCallback(
  callback: (userId: string, prompt: string) => Promise<void>,
): void {
  onCronTrigger = callback;
}

/**
 * 添加一个定时任务
 */
export function addCronJob(
  userId: string,
  expression: string,
  description: string,
  prompt: string,
): string {
  // 验证 cron 表达式是否合法
  if (!cron.validate(expression)) {
    return `Cron 表达式无效: "${expression}"。正确格式示例: "0 9 * * *"（每天9点）, "*/5 * * * *"（每5分钟）`;
  }

  const id = `cron_${nextId++}`;
  const task = cron.schedule(expression, async () => {
    console.log(`[Cron] 触发任务 ${id}: ${description}`);
    if (onCronTrigger) {
      try {
        await onCronTrigger(userId, `[定时任务触发] ${description}\n请执行: ${prompt}`);
      } catch (err) {
        console.error(`[Cron] 任务 ${id} 执行失败:`, err);
      }
    }
  });

  const job: CronJob = {
    id,
    expression,
    description,
    userId,
    prompt,
    task,
    createdAt: new Date().toLocaleString("zh-CN"),
  };

  jobs.set(id, job);
  console.log(`[Cron] 已注册任务 ${id}: "${description}" (${expression})`);

  return `定时任务已创建:\n- ID: ${id}\n- 调度: ${expression}\n- 描述: ${description}\n- 执行内容: ${prompt}`;
}

/**
 * 列出用户的定时任务
 */
export function listCronJobs(userId: string): string {
  const userJobs = [...jobs.values()].filter((j) => j.userId === userId);
  if (userJobs.length === 0) return "当前没有活跃的定时任务。";

  return userJobs
    .map((j) => `- [${j.id}] ${j.description} | 调度: ${j.expression} | 创建: ${j.createdAt}`)
    .join("\n");
}

/**
 * 删除定时任务
 */
export function removeCronJob(jobId: string): string {
  const job = jobs.get(jobId);
  if (!job) return `未找到任务: ${jobId}`;

  job.task.stop();
  jobs.delete(jobId);
  return `定时任务 ${jobId}（${job.description}）已删除`;
}

// ==================== Cron 工具定义（提供给大模型） ====================

export const cronToolDefinitions: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "add_cron_job",
      description:
        "创建一个定时任务。任务会按照 cron 表达式的调度定期触发，届时 AI 会自动执行指定的操作并通过微信通知用户。常用 cron: '0 9 * * *'(每天9点), '0 */2 * * *'(每2小时), '30 8 * * 1-5'(工作日8:30)。",
      parameters: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: "Cron 表达式，如 '0 9 * * *'",
          },
          description: {
            type: "string",
            description: "任务的简短描述，如 '每天早上提醒喝水'",
          },
          prompt: {
            type: "string",
            description: "定时触发时要 AI 执行的操作指令",
          },
        },
        required: ["expression", "description", "prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_cron_jobs",
      description: "列出当前所有活跃的定时任务",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_cron_job",
      description: "删除一个定时任务",
      parameters: {
        type: "object",
        properties: {
          job_id: {
            type: "string",
            description: "要删除的任务 ID，如 'cron_1'",
          },
        },
        required: ["job_id"],
      },
    },
  },
];

/**
 * 执行 Cron 类工具
 */
export function executeCronTool(
  name: string,
  args: Record<string, any>,
  userId: string,
): string {
  switch (name) {
    case "add_cron_job":
      return addCronJob(userId, args.expression, args.description, args.prompt);
    case "list_cron_jobs":
      return listCronJobs(userId);
    case "remove_cron_job":
      return removeCronJob(args.job_id);
    default:
      return `未知 Cron 工具: ${name}`;
  }
}
