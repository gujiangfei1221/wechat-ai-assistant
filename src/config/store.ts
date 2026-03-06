import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../utils/logger.js";

// ==================== Skill 配置加密存储 ====================
// 用于安全保存各 Skill 所需的 API Key、Token 等敏感配置。
// 加密方案：AES-256-GCM，主密钥来自环境变量 CONFIG_MASTER_KEY。
// 存储格式：JSON 文件，每条记录含 iv + authTag + ciphertext（均 hex 编码）。

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bit

interface EncryptedEntry {
  iv: string;
  authTag: string;
  ciphertext: string;
}

type ConfigStore = Record<string, EncryptedEntry>;

let storePath: string | null = null;
let masterKey: Buffer | null = null;

/**
 * 初始化配置存储（由 server.ts 在启动时调用）
 */
export function initConfigStore(dataDir?: string): void {
  const dir = dataDir || path.resolve(process.env.DATA_DIR || "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  storePath = path.join(dir, "skill-config.enc.json");

  // 主密钥：优先读环境变量，不存在则自动生成并提示
  const envKey = process.env.CONFIG_MASTER_KEY;
  if (envKey) {
    // 对环境变量做 SHA-256，保证长度固定为 32 字节
    masterKey = crypto.createHash("sha256").update(envKey).digest();
  } else {
    // 自动生成并写入提示（不写入 .env，只打印警告）
    masterKey = crypto.randomBytes(KEY_LENGTH);
    logger.warn(
      "ConfigStore",
      "未设置 CONFIG_MASTER_KEY 环境变量，本次使用随机密钥。" +
      "重启后已保存的配置将无法解密！请在 .env 中设置 CONFIG_MASTER_KEY=<随机字符串>",
    );
  }

  logger.info("ConfigStore", `配置存储初始化完成: ${storePath}`);
}

function getStore(): ConfigStore {
  if (!storePath) throw new Error("ConfigStore 未初始化，请先调用 initConfigStore()");
  if (!fs.existsSync(storePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(storePath, "utf-8")) as ConfigStore;
  } catch {
    return {};
  }
}

function saveStore(store: ConfigStore): void {
  if (!storePath) throw new Error("ConfigStore 未初始化");
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf-8");
}

function encrypt(plaintext: string): EncryptedEntry {
  if (!masterKey) throw new Error("ConfigStore 未初始化");
  const iv = crypto.randomBytes(12); // GCM 推荐 12 字节 iv
  const cipher = crypto.createCipheriv(ALGORITHM, masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    ciphertext: ciphertext.toString("hex"),
  };
}

function decrypt(entry: EncryptedEntry): string {
  if (!masterKey) throw new Error("ConfigStore 未初始化");
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    masterKey,
    Buffer.from(entry.iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(entry.authTag, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(entry.ciphertext, "hex")),
    decipher.final(),
  ]).toString("utf-8");
}

// ==================== 公开 CRUD 接口 ====================

/**
 * 保存一个配置项（加密存储）
 * @param key   配置键，建议格式：SKILL_NAME.CONFIG_KEY，例如 ticktick.api_token
 * @param value 明文值，存储后立即加密，内存中不保留明文
 */
export function setConfig(key: string, value: string): void {
  const store = getStore();
  store[key.toUpperCase()] = encrypt(value);
  saveStore(store);
  logger.info("ConfigStore", `配置已保存: ${key.toUpperCase()} (已加密)`);
}

/**
 * 读取一个配置项（解密返回明文）
 * @returns 明文值，key 不存在时返回 null
 */
export function getConfig(key: string): string | null {
  const store = getStore();
  const entry = store[key.toUpperCase()];
  if (!entry) return null;
  try {
    return decrypt(entry);
  } catch (err) {
    logger.error("ConfigStore", `解密失败 ${key}，可能是主密钥已更换:`, err);
    return null;
  }
}

/**
 * 删除一个配置项
 */
export function unsetConfig(key: string): boolean {
  const store = getStore();
  const upperKey = key.toUpperCase();
  if (!store[upperKey]) return false;
  delete store[upperKey];
  saveStore(store);
  logger.info("ConfigStore", `配置已删除: ${upperKey}`);
  return true;
}

/**
 * 列出所有已配置的 key（不含值）
 */
export function listConfigKeys(): string[] {
  return Object.keys(getStore());
}

/**
 * 检查某个 key 是否已配置
 */
export function hasConfig(key: string): boolean {
  return key.toUpperCase() in getStore();
}
