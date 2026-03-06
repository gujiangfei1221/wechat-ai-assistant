import axios from "axios";
import { logger } from "../utils/logger.js";

// ==================== 微信客服消息 API ====================

interface AccessTokenCache {
  token: string;
  expiresAt: number;    // token 实际过期时间（ms）
  refreshAt: number;    // 提前刷新触发时间（ms），= expiresAt - 5min
}

let tokenCache: AccessTokenCache | null = null;
/** 并发锁：正在刷新时，其他请求等待同一个 Promise，避免重复调用接口 */
let refreshPromise: Promise<string> | null = null;
/** 主动刷新定时器句柄 */
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 从微信接口拉取新的 Access Token 并更新本地缓存
 */
async function fetchNewToken(): Promise<string> {
  const appId = process.env.WECHAT_APP_ID;
  const appSecret = process.env.WECHAT_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error("缺少 WECHAT_APP_ID 或 WECHAT_APP_SECRET 环境变量");
  }

  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`;
  const { data } = await axios.get(url);

  if (data.errcode) {
    throw new Error(`获取 Access Token 失败: ${data.errcode} - ${data.errmsg}`);
  }

  const now = Date.now();
  const expiresIn: number = data.expires_in; // 微信返回秒数，通常 7200
  const REFRESH_ADVANCE_MS = 5 * 60 * 1000; // 提前 5 分钟刷新

  tokenCache = {
    token: data.access_token,
    expiresAt: now + expiresIn * 1000,
    refreshAt: now + (expiresIn * 1000 - REFRESH_ADVANCE_MS),
  };

  logger.info(
    "微信",
    `Access Token 刷新成功，有效期 ${expiresIn}s，` +
    `将于 ${new Date(tokenCache.refreshAt).toLocaleString()} 自动续期`,
  );

  // 注册下次主动刷新定时器（在 refreshAt 时自动触发）
  scheduleRefresh(tokenCache.refreshAt - now);

  return tokenCache.token;
}

/**
 * 注册主动刷新定时器，在 delayMs 毫秒后触发续期
 */
function scheduleRefresh(delayMs: number): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    logger.info("微信", "Access Token 即将过期，主动触发续期...");
    try {
      refreshPromise = fetchNewToken().finally(() => { refreshPromise = null; });
      await refreshPromise;
    } catch (err) {
      logger.error("微信", "主动续期 Access Token 失败:", err);
      // 续期失败时，5 分钟后重试
      scheduleRefresh(5 * 60 * 1000);
    }
  }, delayMs);
}

/**
 * 获取微信 Access Token
 *
 * 策略（标准 OAuth2 缓存模式）：
 * 1. 缓存有效且未到刷新点 → 直接返回缓存
 * 2. 正在刷新（并发锁）→ 等待同一个 Promise，避免重复请求
 * 3. 缓存不存在或已过刷新点 → 发起新的刷新请求并加锁
 */
export async function getAccessToken(): Promise<string> {
  const now = Date.now();

  // 缓存有效且无需刷新，直接返回
  if (tokenCache && now < tokenCache.refreshAt) {
    return tokenCache.token;
  }

  // 已有并发刷新在进行中，复用同一个 Promise
  if (refreshPromise) {
    return refreshPromise;
  }

  // 发起新的刷新，加并发锁
  refreshPromise = fetchNewToken().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

/**
 * 强制清除 Token 缓存（用于 token 被吊销或 401 错误时）
 */
export function invalidateToken(): void {
  tokenCache = null;
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  logger.info("微信", "Access Token 缓存已清除，下次请求将重新获取");
}

/**
 * 通过客服消息接口主动向用户下发文本消息（绕过 5 秒超时限制）
 * 
 * 注意：微信单条消息最大 2048 字节，超长需要分条发送
 */
export async function sendCustomerMessage(openId: string, content: string): Promise<void> {
  const MAX_LENGTH = 600; // 保险起见，中文约 600 字符
  const chunks = splitMessage(content, MAX_LENGTH);

  for (const chunk of chunks) {
    const token = await getAccessToken();
    const url = `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${token}`;

    const { data } = await axios.post(url, {
      touser: openId,
      msgtype: "text",
      text: { content: chunk },
    });

    if (data.errcode && data.errcode !== 0) {
      logger.error("微信", `发送客服消息失败: ${data.errcode} - ${data.errmsg}`);
      // 如果是 token 过期，清除缓存重试一次
      if (data.errcode === 40001 || data.errcode === 42001) {
        invalidateToken();
        const freshToken = await getAccessToken();
        const retryUrl = `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${freshToken}`;
        await axios.post(retryUrl, {
          touser: openId,
          msgtype: "text",
          text: { content: chunk },
        });
      }
    }

    // 多条消息之间稍作延迟，避免消息乱序
    if (chunks.length > 1) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

/**
 * 智能分割长消息，尽量按段落/换行分割
 */
function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // 尝试在 maxLen 附近找换行符
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt < maxLen * 0.5) {
      // 没有好的换行点，硬切
      splitAt = maxLen;
    }
    chunks.push(remaining.substring(0, splitAt));
    remaining = remaining.substring(splitAt).trimStart();
  }

  return chunks;
}
