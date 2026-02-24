import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { bashExecute } from "./bash.js";
import { readFile, writeFile, editFile } from "./fs.js";

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
];

// ==================== 工具路由执行器 ====================

/**
 * 根据工具名称和参数，路由到对应的本地函数执行
 */
export async function executeTool(
  name: string,
  args: Record<string, any>,
): Promise<string> {
  console.log(`[工具] 执行: ${name}`, JSON.stringify(args).substring(0, 200));

  switch (name) {
    case "bash_execute":
      return bashExecute(args.command, args.cwd);

    case "read_file":
      return readFile(args.path, args.start_line, args.end_line);

    case "write_file":
      return writeFile(args.path, args.content);

    case "edit_file":
      return editFile(args.path, args.target_content, args.replacement_content);

    default:
      return `未知工具: ${name}`;
  }
}
