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
  const startTime = Date.now();

  // 日志：打印即将执行的命令（截断超长命令）
  console.log(`[Bash] 执行命令: ${command.substring(0, 300)}`);
  console.log(`[Bash] 工作目录: ${workDir}`);

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: workDir,
      timeout: 30_000, // 30 秒超时熔断
      maxBuffer: 1024 * 1024, // 1MB 缓冲
      env: { ...process.env, LANG: "en_US.UTF-8" },
    });

    const elapsed = Date.now() - startTime;

    let output = "";
    if (stdout) output += stdout;
    if (stderr) output += (output ? "\n--- stderr ---\n" : "") + stderr;

    if (!output.trim()) output = "(命令执行成功，无输出)";

    // 日志：打印耗时和输出摘要
    const preview = output.substring(0, 200).replace(/\n/g, "\\n");
    console.log(`[Bash] 完成 (${elapsed}ms)，输出 ${output.length} 字符，预览: ${preview}`);

    // 截断过长的输出
    if (output.length > MAX_OUTPUT_LENGTH) {
      output = output.substring(0, MAX_OUTPUT_LENGTH) + `\n...(输出被截断，总长度 ${output.length} 字符)`;
    }

    return output;
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    const errMsg = error.stderr || error.stdout || error.message || String(error);

    // 日志：详细打印错误信息
    console.error(`[Bash] 命令失败 (${elapsed}ms)`);
    console.error(`[Bash] 命令: ${command.substring(0, 300)}`);
    console.error(`[Bash] exit code: ${error.code ?? "unknown"}`);
    console.error(`[Bash] killed (timeout?): ${error.killed ?? false}`);
    console.error(`[Bash] stderr: ${(error.stderr || "").substring(0, 500)}`);
    console.error(`[Bash] stdout: ${(error.stdout || "").substring(0, 500)}`);
    console.error(`[Bash] message: ${error.message || ""}`);

    return `命令执行出错 (exit code: ${error.code ?? "unknown"}, killed: ${error.killed ?? false}):\n${errMsg.substring(0, MAX_OUTPUT_LENGTH)}`;
  }
}
