import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { bashExecute } from "./bash.js";
import { readFile, writeFile, editFile } from "./fs.js";
import { logger } from "../utils/logger.js";
import { getConfig, listConfigKeys } from "../config/store.js";
import { ticktickGetToken } from "./ticktick.js";

// ==================== 工具注册中心 ====================

/**
 * 所有注册工具的 JSON Schema 定义（提供给大模型的"武器清单"）
 */
export const toolDefinitions: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "bash_execute",
      description:
        "在服务器上执行终端命令。适用于运行脚本、检查系统状态、安装软件包、搜索文件(grep/find/rg)等。命令超时时间为30秒。",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "要执行的 shell 命令，例如 'ls -la' 或 'cat /etc/os-release'",
          },
          cwd: {
            type: "string",
            description: "命令的工作目录（可选，默认为 workspace 目录）",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "读取指定文件的内容，返回带行号的文本。支持指定起止行号来读取部分内容。",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "文件的绝对路径或相对于 workspace 的路径",
          },
          start_line: {
            type: "number",
            description: "起始行号（可选，从 1 开始）",
          },
          end_line: {
            type: "number",
            description: "结束行号（可选）",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "将内容写入指定文件（全量覆写）。如果文件不存在会自动创建，包括中间目录。",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "文件的绝对路径或相对于 workspace 的路径",
          },
          content: {
            type: "string",
            description: "要写入的完整文件内容",
          },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "精准编辑文件：查找指定的目标字符串并替换为新内容。目标字符串必须精确匹配文件中的内容（含空格和换行）。",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "文件路径",
          },
          target_content: {
            type: "string",
            description: "要被替换的原始内容（必须精确匹配）",
          },
          replacement_content: {
            type: "string",
            description: "替换后的新内容",
          },
        },
        required: ["path", "target_content", "replacement_content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_skill_config",
      description:
        "读取通过 /set 指令加密存储的 Skill 配置项明文值（如 API Token、Access Token 等）。" +
        "调用此工具比在 bash 里手动解密更安全可靠。" +
        "如果 key 不存在，返回 null，此时应提示用户先用 /set 指令配置。" +
        "可用 list_skill_config_keys 查看所有已配置的 key。",
      parameters: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description:
              "配置项的键名，不区分大小写。例如：TICKTICK.ACCESS_TOKEN、GITHUB.TOKEN",
          },
        },
        required: ["key"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_skill_config_keys",
      description:
        "列出所有已通过 /set 指令配置的 key 名称（不含明文值）。" +
        "用于检查某个技能所需的配置项是否已就绪。",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ticktick_get_token",
      description:
        "【滴答清单专用】获取有效的 access_token。禁止用 get_skill_config 读取 TICKTICK 相关配置，必须使用此工具。" +
        "自动处理：① token 有效直接返回；② 快过期时静默刷新；③ 未配置时返回 SETUP_REQUIRED（引导用户配置）；" +
        "④ 未授权时返回 AUTH_REQUIRED + OAUTH_URL（把 OAUTH_URL 发给用户点击）。",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
];

// ==================== 工具路由执行器 ====================

/**
 * 根据工具名称和参数，路由到对应的本地函数执行。
 * @param userId 当前用户的微信 openid，供 ticktick 等需要用户身份的工具使用
 */
export async function executeTool(
  name: string,
  args: Record<string, any>,
  userId?: string,
): Promise<string> {
  logger.info("工具", `执行: ${name} ${JSON.stringify(args).substring(0, 200)}`);

  switch (name) {
    case "bash_execute":
      return bashExecute(args.command, args.cwd);

    case "read_file":
      return readFile(args.path, args.start_line, args.end_line);

    case "write_file":
      return writeFile(args.path, args.content);

    case "edit_file":
      return editFile(args.path, args.target_content, args.replacement_content);

    case "get_skill_config": {
      const key = String(args.key || "");
      if (!key) return "❌ 请提供 key 参数。";

      // 拦截 TICKTICK 相关 key → 必须走 ticktick_get_token 工具
      if (key.toUpperCase().startsWith("TICKTICK.")) {
        logger.info("工具", `get_skill_config: 拦截 ${key.toUpperCase()}，转发到 ticktick_get_token`);
        return "⚠️ 请勿直接读取 TICKTICK 配置项。请改用 ticktick_get_token 工具获取有效的 access_token，它会自动处理授权、续期等流程。";
      }

      const value = getConfig(key);
      if (value === null) {
        logger.warn("工具", `get_skill_config: key ${key.toUpperCase()} 未配置`);
        return `null（${key.toUpperCase()} 未配置，请提示用户先发送 /set ${key.toUpperCase()}=<值> 进行配置）`;
      }
      logger.info("工具", `get_skill_config: 成功读取 ${key.toUpperCase()}（已脱敏）`);
      return value;
    }

    case "list_skill_config_keys": {
      const keys = listConfigKeys();
      if (keys.length === 0) return "暂无已配置的 Skill 配置项。";
      return `已配置 ${keys.length} 个配置项：\n${keys.map((k) => `  • ${k}`).join("\n")}`;
    }

    case "ticktick_get_token":
      return ticktickGetToken(userId ?? "unknown");

    default:
      return `未知工具: ${name}`;
  }
}
