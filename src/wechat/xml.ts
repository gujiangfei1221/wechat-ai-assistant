import { parseStringPromise } from "xml2js";
import crypto from "node:crypto";

// ==================== 微信 XML 消息解析 ====================

export interface WechatTextMessage {
  toUserName: string;
  fromUserName: string;
  createTime: number;
  msgType: string;
  content: string;
  msgId: string;
}

/**
 * 解析微信推送过来的 XML 消息体
 */
export async function parseWechatXml(xmlBody: string): Promise<WechatTextMessage> {
  const result = await parseStringPromise(xmlBody, { explicitArray: false });
  const msg = result.xml;
  return {
    toUserName: msg.ToUserName,
    fromUserName: msg.FromUserName,
    createTime: Number(msg.CreateTime),
    msgType: msg.MsgType,
    content: msg.Content ?? "",
    msgId: msg.MsgId ?? "",
  };
}

/**
 * 构建被动回复的 XML（用于 5 秒内快速回复）
 */
export function buildTextReplyXml(fromUser: string, toUser: string, content: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  return `<xml>
  <ToUserName><![CDATA[${fromUser}]]></ToUserName>
  <FromUserName><![CDATA[${toUser}]]></FromUserName>
  <CreateTime>${timestamp}</CreateTime>
  <MsgType><![CDATA[text]]></MsgType>
  <Content><![CDATA[${content}]]></Content>
</xml>`;
}

/**
 * 微信签名验证
 */
export function verifyWechatSignature(
  token: string,
  signature: string,
  timestamp: string,
  nonce: string,
): boolean {
  const arr = [token, timestamp, nonce].sort();
  const str = arr.join("");
  const sha1 = crypto.createHash("sha1").update(str).digest("hex");
  return sha1 === signature;
}
