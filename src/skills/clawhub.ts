import { bashExecute } from "../tools/bash.js";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import path from "node:path";
import fs from "node:fs";
import { logger } from "../utils/logger.js";

// ==================== ClawHub 技能商店集成 ====================
// 让 AI 助理可以自主从 ClawHub 搜索和安装新技能

const SKILLS_DIR = path.resolve(process.env.CONFIG_DIR || "config", "skills");

/**
 * 确保 clawhub CLI 已安装
 */
async function ensureClawHubInstalled(): Promise<boolean> {
  const result = await bashExecute("which clawhub || command -v clawhub");
  if (result.includes("clawhub")) return true;

  // 尝试自动安装
  logger.info("ClawHub", "clawhub CLI 未安装，正在自动安装...");
  const installResult = await bashExecute("npm install -g clawhub 2>&1");
  logger.info("ClawHub", `安装结果: ${installResult}`);

  // 再次检查
  const recheck = await bashExecute("which clawhub || command -v clawhub");
  return recheck.includes("clawhub");
}

/**
 * 搜索 ClawHub 技能商店
 */
export async function searchClawHub(query: string): Promise<string> {
  const installed = await ensureClawHubInstalled();
  if (!installed) {
    return "ClawHub CLI 安装失败。请手动运行: npm install -g clawhub";
  }

  const result = await bashExecute(`clawhub search "${query}" 2>&1`);
  return result || "未找到匹配的技能。";
}

/**
 * 从 ClawHub 安装技能到本地 skills 目录
 */
export async function installFromClawHub(
  skillName: string,
  version?: string,
): Promise<string> {
  const installed = await ensureClawHubInstalled();
  if (!installed) {
    return "ClawHub CLI 安装失败。请手动运行: npm install -g clawhub";
  }

  // 确保 skills 目录存在
  if (!fs.existsSync(SKILLS_DIR)) {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
  }

  const versionFlag = version ? ` --version ${version}` : "";
  const result = await bashExecute(
    `clawhub install ${skillName}${versionFlag} --dir "${SKILLS_DIR}" 2>&1`,
  );

  // 检查是否安装成功
  const skillDir = path.join(SKILLS_DIR, skillName);
  const skillMd = path.join(skillDir, "SKILL.md");
  if (fs.existsSync(skillMd)) {
    return `✅ 技能 "${skillName}" 安装成功！\n安装位置: ${skillDir}\n\n${result}\n\n⚠️ 新技能将在下次对话时自动加载。如需立即生效，请发送 /reload 命令。`;
  }

  return `安装过程输出:\n${result}`;
}

/**
 * 列出本地已安装的技能
 */
export function listInstalledSkills(): string {
  if (!fs.existsSync(SKILLS_DIR)) {
    return "技能目录不存在，尚未安装任何技能。";
  }

  const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  const skills: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skillMd = path.join(SKILLS_DIR, entry.name, "SKILL.md");
      if (fs.existsSync(skillMd)) {
        // 读取 frontmatter 中的 description
        const raw = fs.readFileSync(skillMd, "utf-8");
        const descMatch = raw.match(/description:\s*["']?(.+?)["']?\s*$/m);
        const desc = descMatch ? descMatch[1].trim().substring(0, 80) : "(无描述)";
        skills.push(`📦 ${entry.name}: ${desc}`);
      }
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      const name = path.basename(entry.name, ".md");
      skills.push(`📄 ${name} (自定义)`);
    }
  }

  if (skills.length === 0) return "尚未安装任何技能。";
  return `已安装 ${skills.length} 个技能:\n\n${skills.join("\n")}`;
}

/**
 * 更新已安装的技能
 */
export async function updateClawHubSkill(
  skillName: string,
  force: boolean = false,
): Promise<string> {
  const installed = await ensureClawHubInstalled();
  if (!installed) {
    return "ClawHub CLI 安装失败。请手动运行: npm install -g clawhub";
  }

  const forceFlag = force ? " --force" : "";
  const target = skillName === "--all" ? "--all" : skillName;

  const result = await bashExecute(
    `clawhub update ${target}${forceFlag} --dir "${SKILLS_DIR}" 2>&1`,
  );

  return `更新结果:\n${result}`;
}

// ==================== ClawHub 工具定义（提供给大模型） ====================

export const clawHubToolDefinitions: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "clawhub_search",
      description:
        "在 ClawHub 技能商店中搜索可用的 AI 技能。当用户询问是否有某种能力、需要新的技能、或你自己觉得缺少某个领域的能力时使用。",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "搜索关键词，如 'weather'、'email'、'database'、'pdf'",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "clawhub_install",
      description:
        "从 ClawHub 技能商店安装一个新技能到本地。安装后技能会在下次对话时自动生效。",
      parameters: {
        type: "object",
        properties: {
          skill_name: {
            type: "string",
            description: "要安装的技能名称（来自 clawhub_search 的结果）",
          },
          version: {
            type: "string",
            description: "指定版本号（可选，默认安装最新版）",
          },
        },
        required: ["skill_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "clawhub_list",
      description: "列出本地已安装的所有技能及其描述",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "clawhub_update",
      description: "更新已安装的技能到最新版本。可以更新单个技能或全部技能。",
      parameters: {
        type: "object",
        properties: {
          skill_name: {
            type: "string",
            description: "要更新的技能名称，传 '--all' 可更新全部",
          },
          force: {
            type: "boolean",
            description: "是否强制更新（忽略本地修改）",
          },
        },
        required: ["skill_name"],
      },
    },
  },
];

/**
 * 执行 ClawHub 类工具
 */
export async function executeClawHubTool(
  name: string,
  args: Record<string, any>,
): Promise<string> {
  switch (name) {
    case "clawhub_search":
      return searchClawHub(args.query);
    case "clawhub_install":
      return installFromClawHub(args.skill_name, args.version);
    case "clawhub_list":
      return listInstalledSkills();
    case "clawhub_update":
      return updateClawHubSkill(args.skill_name, args.force);
    default:
      return `未知 ClawHub 工具: ${name}`;
  }
}
