import { getConfig, setConfig } from "../config/store.js";
import { logger } from "../utils/logger.js";

// ==================== TickTick OAuth 2.0 Token 管理 ====================
//
// 用户只需配置（通过 /set 指令）：
//   必须：TICKTICK.CLIENT_ID      应用的 client_id
//         TICKTICK.CLIENT_SECRET  应用的 client_secret
//
// 以下由工具自动写入，无需手动配置：
//         TICKTICK.ACCESS_TOKEN   访问令牌
//         TICKTICK.REFRESH_TOKEN  刷新令牌
//         TICKTICK.EXPIRES_AT     过期时间（Unix 秒）
//
// 回调地址自动使用：{SERVER_URL}/ticktick/callback
// （SERVER_URL 取自环境变量，例如 https://your-domain.com）

const AUTH_URL = "https://dida365.com/oauth/authorize";
const TOKEN_URL = "https://dida365.com/oauth/token";

/** 剩余有效期少于此值时触发自动刷新（7 天）*/
const EXPIRY_BUFFER_SEC = 7 * 24 * 3600;

// ==================== 内部工具函数 ====================

/**
 * 获取 OAuth 回调地址。
 * 优先读配置存储中的 TICKTICK.REDIRECT_URI，
 * 否则自动使用 SERVER_URL 环境变量拼接。
 */
export function getRedirectUri(): string {
    const stored = getConfig("TICKTICK.REDIRECT_URI");
    if (stored) return stored;

    const serverUrl =
        process.env.SERVER_URL ||
        `http://localhost:${process.env.PORT ?? 3000}`;
    return `${serverUrl}/ticktick/callback`;
}

/**
 * 用 refresh_token 静默换新 access_token，成功后更新存储。
 * @returns 新的 access_token
 */
async function doRefreshToken(
    clientId: string,
    clientSecret: string,
    refreshToken: string,
): Promise<string> {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        redirect_uri: getRedirectUri(),
    });

    const resp = await fetch(TOKEN_URL, {
        method: "POST",
        headers: {
            Authorization: `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
    });

    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${text}`);
    }

    const data = (await resp.json()) as Record<string, any>;
    const newToken = String(data.access_token ?? "");
    const newRefresh = String(data.refresh_token ?? refreshToken);
    const expiresIn = Number(data.expires_in ?? 7776000);
    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

    setConfig("TICKTICK.ACCESS_TOKEN", newToken);
    setConfig("TICKTICK.REFRESH_TOKEN", newRefresh);
    setConfig("TICKTICK.EXPIRES_AT", String(expiresAt));

    const expireDate = new Date(expiresAt * 1000).toLocaleDateString("zh-CN", {
        timeZone: "Asia/Shanghai",
    });
    logger.info("TickTick", `Token 已自动刷新，新过期日: ${expireDate}`);
    return newToken;
}

// ==================== 导出工具实现 ====================

/**
 * 工具：ticktick_get_token
 *
 * 返回一个当前有效的 access_token。
 * ① token 健康 → 直接返回
 * ② token 快过期 → 自动用 refresh_token 续期并返回
 * ③ 从未授权 / 刷新失败 → 返回授权链接，用户点击后服务器自动完成后续步骤
 *
 * @param userId 当前用户的微信 openid，用于授权成功后发送通知
 */
export async function ticktickGetToken(userId: string): Promise<string> {
    const clientId = getConfig("TICKTICK.CLIENT_ID");
    const clientSecret = getConfig("TICKTICK.CLIENT_SECRET");
    const redirectUri = getRedirectUri();

    // ── 检查是否满足运行条件 ──
    // redirectUri 是 localhost 意味着 SERVER_URL 未配置，OAuth 回调无法在手机上接收
    const redirectIsLocalhost = redirectUri.includes("localhost") || redirectUri.includes("127.0.0.1");

    if (!clientId || !clientSecret || redirectIsLocalhost) {
        const missing: string[] = [];
        if (!clientId) missing.push("TICKTICK.CLIENT_ID");
        if (!clientSecret) missing.push("TICKTICK.CLIENT_SECRET");
        if (redirectIsLocalhost) missing.push("TICKTICK.REDIRECT_URI（当前为 localhost，需要配置真实服务器地址）");

        return [
            "SETUP_REQUIRED",
            `MISSING: ${missing.join(", ")}`,
            `CURRENT_REDIRECT_URI: ${redirectUri}`,
        ].join("\n");
    }

    const accessToken = getConfig("TICKTICK.ACCESS_TOKEN");
    const refreshToken = getConfig("TICKTICK.REFRESH_TOKEN");
    const expiresAtStr = getConfig("TICKTICK.EXPIRES_AT");

    // ── 已有 token ──
    if (accessToken && expiresAtStr) {
        const expiresAt = parseInt(expiresAtStr, 10);
        const now = Math.floor(Date.now() / 1000);
        const remaining = expiresAt - now;

        if (remaining > EXPIRY_BUFFER_SEC) {
            logger.info("TickTick", `复用现有 token，剩余 ${Math.floor(remaining / 86400)} 天`);
            return accessToken;
        }

        // Token 快过期，尝试刷新（需要 refresh_token）
        if (refreshToken) {
            logger.info("TickTick", `Token 剩余 ${Math.floor(remaining / 86400)} 天，自动刷新中...`);
            try {
                return await doRefreshToken(clientId, clientSecret, refreshToken);
            } catch (err: any) {
                logger.warn("TickTick", `自动刷新失败（${err.message}），引导用户重新授权`);
            }
        } else if (remaining > 0) {
            // 没有 refresh_token 但 token 还没过期，继续用
            logger.info("TickTick", `Token 剩余 ${Math.floor(remaining / 86400)} 天（无 refresh_token，无法自动续期）`);
            return accessToken;
        }
    }

    // ── 未授权 / 刷新失败：生成授权链接 ──
    const state = encodeURIComponent(userId);
    const authUrl =
        `${AUTH_URL}?client_id=${encodeURIComponent(clientId)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent("tasks:write tasks:read")}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&state=${state}`;

    // 用明确标签区分两个 URL，避免 AI 混淆
    return [
        "AUTH_REQUIRED",
        `OAUTH_URL: ${authUrl}`,
        `CALLBACK_URL: ${redirectUri}`,
    ].join("\n");
}

/**
 * 回调处理：用 authorization code 换取并存储 token。
 * 由 server.ts 的 /ticktick/callback 路由调用，不作为 AI 工具注册。
 *
 * @param code  OAuth 回调中的 authorization_code
 * @param userId 从 state 参数恢复的微信 openid
 */
export async function ticktickHandleCallback(
    code: string,
    userId: string,
): Promise<void> {
    const clientId = getConfig("TICKTICK.CLIENT_ID");
    const clientSecret = getConfig("TICKTICK.CLIENT_SECRET");
    const redirectUri = getRedirectUri();

    if (!clientId || !clientSecret) {
        throw new Error("CLIENT_ID 或 CLIENT_SECRET 未配置");
    }

    logger.info("TickTick", `处理 OAuth 回调，userId: ${userId}`);

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const body = new URLSearchParams({
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
    });

    const resp = await fetch(TOKEN_URL, {
        method: "POST",
        headers: {
            Authorization: `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
    });

    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${text}`);
    }

    const data = (await resp.json()) as Record<string, any>;
    const accessToken = String(data.access_token ?? "");
    const refreshToken = String(data.refresh_token ?? "");
    const expiresIn = Number(data.expires_in ?? 7776000);
    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

    setConfig("TICKTICK.ACCESS_TOKEN", accessToken);
    if (refreshToken) setConfig("TICKTICK.REFRESH_TOKEN", refreshToken);
    setConfig("TICKTICK.EXPIRES_AT", String(expiresAt));

    const expireDate = new Date(expiresAt * 1000).toLocaleDateString("zh-CN", {
        timeZone: "Asia/Shanghai",
    });
    logger.info("TickTick", `首次授权成功，token 过期日: ${expireDate}`);
}
