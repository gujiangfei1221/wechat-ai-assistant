import axios from "axios";

// ==================== 微信客服消息 API ====================

interface AccessTokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: AccessTokenCache | null = null;

/**
 * 获取微信 Access Token（自动缓存，提前 5 分钟刷新）
 */
export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now) {
    return tokenCache.token;
  }

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

  tokenCache = {
    token: data.access_token,
    // 提前 5 分钟过期，避免临界点失效
    expiresAt: now + (data.expires_in - 300) * 1000,
  };

  console.log("[微信] Access Token 获取成功，有效期至", new Date(tokenCache.expiresAt).toLocaleString());
  return tokenCache.token;
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
      console.error(`[微信] 发送客服消息失败: ${data.errcode} - ${data.errmsg}`);
      // 如果是 token 过期，清除缓存重试一次
      if (data.errcode === 40001 || data.errcode === 42001) {
        tokenCache = null;
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
