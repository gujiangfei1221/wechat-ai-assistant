import Database from "better-sqlite3";
import path from "node:path";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

// ==================== SQLite 长期记忆系统 ====================

let db: Database.Database | null = null;

/**
 * 初始化记忆数据库
 */
export function initMemoryDB(dbPath?: string): void {
  const resolvedPath = dbPath || path.resolve(process.env.WORKSPACE_DIR || ".", "memory.db");
  db = new Database(resolvedPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);
    CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
  `);

  console.log("[记忆] SQLite 数据库初始化完成:", resolvedPath);
}

function getDB(): Database.Database {
  if (!db) throw new Error("记忆数据库未初始化，请先调用 initMemoryDB()");
  return db;
}

/**
 * 保存一条记忆
 */
export function saveMemory(userId: string, content: string, category: string = "general"): string {
  const stmt = getDB().prepare(
    "INSERT INTO memories (user_id, category, content) VALUES (?, ?, ?)",
  );
  const result = stmt.run(userId, category, content);
  return `记忆已保存 (ID: ${result.lastInsertRowid}，分类: ${category})`;
}

/**
 * 搜索记忆（简单关键词匹配）
 */
export function searchMemory(userId: string, query: string, limit: number = 10): string {
  const stmt = getDB().prepare(
    "SELECT id, category, content, created_at FROM memories WHERE user_id = ? AND content LIKE ? ORDER BY updated_at DESC LIMIT ?",
  );
  const rows = stmt.all(userId, `%${query}%`, limit) as any[];

  if (rows.length === 0) {
    return "没有找到相关记忆。";
  }

  return rows
    .map((r) => `[#${r.id} ${r.category}] ${r.content} (${r.created_at})`)
    .join("\n");
}

/**
 * 获取用户最近的记忆摘要（用于注入到 System Prompt）
 */
export function getRecentMemories(userId: string, limit: number = 20): string {
  const stmt = getDB().prepare(
    "SELECT category, content, created_at FROM memories WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?",
  );
  const rows = stmt.all(userId, limit) as any[];

  if (rows.length === 0) return "";

  return rows
    .map((r) => `- [${r.category}] ${r.content}`)
    .join("\n");
}

/**
 * 删除指定记忆
 */
export function deleteMemory(userId: string, memoryId: number): string {
  const stmt = getDB().prepare("DELETE FROM memories WHERE id = ? AND user_id = ?");
  const result = stmt.run(memoryId, userId);
  return result.changes > 0 ? `记忆 #${memoryId} 已删除` : `未找到记忆 #${memoryId}`;
}

// ==================== Memory 工具定义（提供给大模型） ====================

export const memoryToolDefinitions: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "save_memory",
      description:
        "保存一条关于用户的长期记忆。当用户告诉你重要的个人信息（偏好、习惯、项目背景、联系人信息等）时使用此工具，以便未来的对话中记住。",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "要记忆的内容，用一句简洁的话概括",
          },
          category: {
            type: "string",
            description: "记忆分类，如 'preference'（偏好）、'project'（项目）、'person'（人物）、'habit'（习惯）等",
            enum: ["preference", "project", "person", "habit", "todo", "general"],
          },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_memory",
      description: "搜索关于用户的历史记忆。当需要回忆用户之前说过的话、偏好或项目背景时使用。",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "搜索关键词",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_memory",
      description: "删除一条不再需要的记忆",
      parameters: {
        type: "object",
        properties: {
          memory_id: {
            type: "number",
            description: "要删除的记忆 ID",
          },
        },
        required: ["memory_id"],
      },
    },
  },
];

/**
 * 执行记忆类工具
 */
export function executeMemoryTool(
  name: string,
  args: Record<string, any>,
  userId: string,
): string {
  switch (name) {
    case "save_memory":
      return saveMemory(userId, args.content, args.category || "general");
    case "search_memory":
      return searchMemory(userId, args.query);
    case "delete_memory":
      return deleteMemory(userId, args.memory_id);
    default:
      return `未知记忆工具: ${name}`;
  }
}
