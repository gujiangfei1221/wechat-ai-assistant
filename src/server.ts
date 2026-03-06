import "dotenv/config";
import express from "express";
import crypto from "node:crypto";
import { parseWechatXml, buildTextReplyXml, verifyWechatSignature } from "./wechat/xml.js";
import { sendCustomerMessage } from "./wechat/api.js";
import { initMemoryDB } from "./memory/index.js";
import { initAgent, runAgentLoop } from "./agent/loop.js";
import { setCronTriggerCallback } from "./cron/manager.js";
import { startSessionCleanup } from "./agent/session.js";
import { logger } from "./utils/logger.js";

// ==================== 微信 AI 助理服务器 ====================

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// 微信的消息体是 XML，需要原始 body
app.use(express.text({ type: "text/xml" }));
app.use(express.urlencoded({ extended: true }));

// 用于追踪正在处理中的请求，避免重复处理
const processingTasks = new Set<string>();

// ==================== 微信 Webhook 验证 ====================
app.get("/wechat", (req, res) => {
  const { signature, timestamp, nonce, echostr } = req.query;
  const token = process.env.WECHAT_TOKEN || "";
  const incomingSignature = typeof signature === "string" ? signature : "";
  const incomingTimestamp = typeof timestamp === "string" ? timestamp : "";
  const incomingNonce = typeof nonce === "string" ? nonce : "";
  const incomingEchostr = typeof echostr === "string" ? echostr : "";

  const expectedSignature = crypto
    .createHash("sha1")
    .update([token, incomingTimestamp, incomingNonce].sort().join(""))
    .digest("hex");

  if (
    incomingSignature &&
    incomingTimestamp &&
    incomingNonce &&
    incomingEchostr &&
    verifyWechatSignature(token, incomingSignature, incomingTimestamp, incomingNonce)
  ) {
    logger.info("微信", "Webhook 验证成功", {
      hasToken: Boolean(token),
      tokenLength: token.length,
      timestamp: incomingTimestamp,
      nonce: incomingNonce,
      signaturePrefix: incomingSignature.slice(0, 8),
      expectedSignaturePrefix: expectedSignature.slice(0, 8),
      ip: req.ip,
    });
    res.send(incomingEchostr);
  } else {
    logger.warn("微信", "Webhook 验证失败", {
      hasToken: Boolean(token),
      tokenLength: token.length,
      hasSignature: Boolean(incomingSignature),
      hasTimestamp: Boolean(incomingTimestamp),
      hasNonce: Boolean(incomingNonce),
      hasEchostr: Boolean(incomingEchostr),
      timestamp: incomingTimestamp || "<empty>",
      nonce: incomingNonce || "<empty>",
      signaturePrefix: incomingSignature ? incomingSignature.slice(0, 8) : "<empty>",
      expectedSignaturePrefix: expectedSignature.slice(0, 8),
      ip: req.ip,
      userAgent: req.get("user-agent") || "<unknown>",
    });
    res.status(403).send("验证失败");
  }
});

// ==================== 接收微信消息 ====================
app.post("/wechat", async (req, res) => {
  try {
    const xmlBody = req.body as string;
    const msg = await parseWechatXml(xmlBody);

    // 只处理文本消息
    if (msg.msgType !== "text") {
      const reply = buildTextReplyXml(
        msg.fromUserName,
        msg.toUserName,
        "暂时只支持文本消息哦 😊",
      );
      res.type("application/xml").send(reply);
      return;
    }

    const userId = msg.fromUserName;
    const userText = msg.content.trim();
    const taskKey = `${userId}:${msg.msgId}`;

    logger.info("微信", `收到消息 [${userId}]: ${userText}`);

    // 防重复（微信可能重试推送同一条消息）
    if (processingTasks.has(taskKey)) {
      res.send("success");
      return;
    }
    processingTasks.add(taskKey);

    // ⚡ 核心策略：先在 5 秒内返回"收到"，然后后台异步跑 Agent
    const reply = buildTextReplyXml(
      msg.fromUserName,
      msg.toUserName,
      "🤔 收到，正在思考...",
    );
    res.type("application/xml").send(reply);

    // 后台异步执行 AI Agent Loop
    handleMessageAsync(userId, userText, taskKey).catch((err) => {
      logger.error("Server", "异步处理失败:", err);
    });
  } catch (error) {
    logger.error("Server", "消息解析/处理错误:", error);
    res.send("success"); // 微信要求即使出错也返回 success
  }
});

/**
 * 异步处理用户消息（不阻塞微信 5 秒超时）
 */
async function handleMessageAsync(
  userId: string,
  userText: string,
  taskKey: string,
): Promise<void> {
  try {
    logger.info("Agent", `开始处理 [${userId}]: ${userText}`);
    const startTime = Date.now();

    // 运行 ReAct Loop
    const result = await runAgentLoop(userId, userText);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info("Agent", `处理完成，耗时 ${elapsed}s`);

    // 通过客服消息 API 主动推送结果
    await sendCustomerMessage(userId, result);

    logger.info("Agent", `回复已发送 [${userId}]`);
  } catch (error: any) {
    logger.error("Agent", `处理失败 [${userId}]:`, error);
    try {
      await sendCustomerMessage(userId, `❌ 处理出错: ${error.message || "未知错误"}`);
    } catch {
      // 连发错误消息都失败了，只能记日志
      logger.error("Agent", "发送错误通知也失败了");
    }
  } finally {
    processingTasks.delete(taskKey);
  }
}

// ==================== 健康检查 ====================
app.get("/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// ==================== 启动服务 ====================
async function start(): Promise<void> {
  logger.info("Server", "=========================================");
  logger.info("Server", "    🤖 微信 AI 助理 启动中...");
  logger.info("Server", "=========================================");

  // 初始化记忆数据库
  initMemoryDB();

  // 初始化 Agent（连接硅基流动 + 加载 Skills）
  initAgent();

  // 注册 Cron 触发回调：定时任务到期时，自动拉起 Agent 并推送结果到微信
  setCronTriggerCallback(async (userId: string, prompt: string) => {
    logger.info("Cron", `为用户 ${userId} 执行定时任务`);
    const result = await runAgentLoop(userId, prompt);
    await sendCustomerMessage(userId, `⏰ 定时任务结果:\n${result}`);
  });

  // 启动 Session 过期清理
  startSessionCleanup();

  app.listen(PORT, () => {
    logger.info("Server", `微信 Webhook 地址: http://localhost:${PORT}/wechat`);
    logger.info("Server", `健康检查: http://localhost:${PORT}/health`);
    logger.info("Server", "等待微信消息...");
    logger.info("Server", "=========================================");
  });
}

start().catch((err) => {
  logger.error("Server", "启动失败:", err);
  process.exit(1);
});
