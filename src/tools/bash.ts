import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const MAX_OUTPUT_LENGTH = 4000; // 限制输出长度，避免爆上下文

/**
 * 执行终端命令
 * 
 * 安全警告：此工具拥有完整的 shell 权限，适合纯个人使用场景。
 * 如果是多人服务，必须加上沙箱/白名单机制。
 */
export async function bashExecute(command: string, cwd?: string): Promise<string> {
  const workDir = cwd || process.env.WORKSPACE_DIR || process.cwd();

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: workDir,
      timeout: 30_000, // 30 秒超时熔断
      maxBuffer: 1024 * 1024, // 1MB 缓冲
      env: { ...process.env, LANG: "en_US.UTF-8" },
    });

    let output = "";
    if (stdout) output += stdout;
    if (stderr) output += (output ? "\n--- stderr ---\n" : "") + stderr;

    if (!output.trim()) output = "(命令执行成功，无输出)";

    // 截断过长的输出
    if (output.length > MAX_OUTPUT_LENGTH) {
      output = output.substring(0, MAX_OUTPUT_LENGTH) + `\n...(输出被截断，总长度 ${output.length} 字符)`;
    }

    return output;
  } catch (error: any) {
    const errMsg = error.stderr || error.stdout || error.message || String(error);
    return `命令执行出错 (exit code: ${error.code ?? "unknown"}):\n${errMsg.substring(0, MAX_OUTPUT_LENGTH)}`;
  }
}
