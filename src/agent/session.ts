import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

// ==================== 会话管理（内存存储） ====================
// 每个微信用户（通过 OpenID 标识）拥有独立的对话历史

interface Session {
  messages: ChatCompletionMessageParam[];
  lastActive: number;
}

const sessions = new Map<string, Session>();

const MAX_HISTORY_TURNS = 30; // 保留最近 30 轮对话
const SESSION_EXPIRE_MS = 2 * 60 * 60 * 1000; // 2 小时无活动则清空

/**
 * 获取用户的会话历史
 */
export function getSession(userId: string): ChatCompletionMessageParam[] {
  const session = sessions.get(userId);
  if (!session) return [];

  // 检查是否过期
  if (Date.now() - session.lastActive > SESSION_EXPIRE_MS) {
    sessions.delete(userId);
    return [];
  }

  return session.messages;
}

/**
 * 追加消息到会话历史
 */
export function appendMessage(userId: string, message: ChatCompletionMessageParam): void {
  let session = sessions.get(userId);
  if (!session) {
    session = { messages: [], lastActive: Date.now() };
    sessions.set(userId, session);
  }

  session.messages.push(message);
  session.lastActive = Date.now();

  // 裁剪过长的历史（保留 system prompt 和最近的对话）
  trimHistory(session);
}

/**
 * 批量追加消息
 */
export function appendMessages(userId: string, messages: ChatCompletionMessageParam[]): void {
  for (const msg of messages) {
    appendMessage(userId, msg);
  }
}

/**
 * 清空用户会话
 */
export function clearSession(userId: string): void {
  sessions.delete(userId);
}

/**
 * 裁剪历史：保留最近 N 轮对话
 */
function trimHistory(session: Session): void {
  // 每轮对话 = 1 user + 1 assistant (可能带 tool_calls + tool results)
  // 粗略估计每轮约 2-6 条消息
  const maxMessages = MAX_HISTORY_TURNS * 4;

  if (session.messages.length > maxMessages) {
    // 保留前面可能的系统消息 + 最近的对话
    const systemMsgs = session.messages.filter((m) => m.role === "system");
    const recentMsgs = session.messages.slice(-maxMessages);

    // 如果最近消息里没有 system，在前面加上
    if (systemMsgs.length > 0 && recentMsgs[0]?.role !== "system") {
      session.messages = [...systemMsgs, ...recentMsgs];
    } else {
      session.messages = recentMsgs;
    }
  }
}

/**
 * 定期清理过期 session（每 10 分钟运行）
 */
export function startSessionCleanup(): void {
  setInterval(() => {
    const now = Date.now();
    for (const [userId, session] of sessions) {
      if (now - session.lastActive > SESSION_EXPIRE_MS) {
        sessions.delete(userId);
        console.log(`[Session] 清理过期会话: ${userId}`);
      }
    }
  }, 10 * 60 * 1000);
}
