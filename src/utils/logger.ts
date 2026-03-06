// ==================== 统一日志工具 ====================
// 输出格式: [2026-03-06 12:00:00.000] [LEVEL] [模块] 消息

type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

function timestamp(): string {
  return new Date().toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).replace(/\//g, "-") + "." + String(new Date().getMilliseconds()).padStart(3, "0");
}

function format(level: LogLevel, module: string, msg: string): string {
  return `[${timestamp()}] [${level.padEnd(5)}] [${module}] ${msg}`;
}

export const logger = {
  info(module: string, msg: string, ...args: any[]): void {
    console.log(format("INFO", module, msg), ...args);
  },
  warn(module: string, msg: string, ...args: any[]): void {
    console.warn(format("WARN", module, msg), ...args);
  },
  error(module: string, msg: string, ...args: any[]): void {
    console.error(format("ERROR", module, msg), ...args);
  },
  debug(module: string, msg: string, ...args: any[]): void {
    if (process.env.LOG_LEVEL === "debug") {
      console.log(format("DEBUG", module, msg), ...args);
    }
  },
};
