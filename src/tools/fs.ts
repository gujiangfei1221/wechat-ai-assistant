import fs from "node:fs/promises";
import path from "node:path";

const MAX_READ_LENGTH = 8000; // 限制读取长度

/**
 * 读取文件内容，带行号
 */
export async function readFile(
  filePath: string,
  startLine?: number,
  endLine?: number,
): Promise<string> {
  try {
    const absPath = path.resolve(filePath);
    const content = await fs.readFile(absPath, "utf-8");
    const lines = content.split("\n");

    const start = Math.max(1, startLine ?? 1);
    const end = Math.min(lines.length, endLine ?? lines.length);

    const numbered = lines
      .slice(start - 1, end)
      .map((line, i) => `${start + i}: ${line}`)
      .join("\n");

    if (numbered.length > MAX_READ_LENGTH) {
      return numbered.substring(0, MAX_READ_LENGTH) + `\n...(文件被截断，总计 ${lines.length} 行)`;
    }

    return `文件: ${absPath} (共 ${lines.length} 行，显示 ${start}-${end})\n${"─".repeat(40)}\n${numbered}`;
  } catch (error: any) {
    return `读取文件失败: ${error.message}`;
  }
}

/**
 * 写入文件（全量覆写）
 */
export async function writeFile(filePath: string, content: string): Promise<string> {
  try {
    const absPath = path.resolve(filePath);
    // 确保目录存在
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, content, "utf-8");
    return `文件写入成功: ${absPath} (${content.length} 字符)`;
  } catch (error: any) {
    return `写入文件失败: ${error.message}`;
  }
}

/**
 * 精准字符串替换（编辑文件）
 */
export async function editFile(
  filePath: string,
  targetContent: string,
  replacementContent: string,
): Promise<string> {
  try {
    const absPath = path.resolve(filePath);
    const original = await fs.readFile(absPath, "utf-8");

    if (!original.includes(targetContent)) {
      return `编辑失败: 在文件 ${absPath} 中未找到目标内容。请检查目标字符串是否精确匹配（包括空格和换行）。`;
    }

    const updated = original.replace(targetContent, replacementContent);
    await fs.writeFile(absPath, updated, "utf-8");

    return `编辑成功: ${absPath} (替换了 ${targetContent.length} 字符 -> ${replacementContent.length} 字符)`;
  } catch (error: any) {
    return `编辑文件失败: ${error.message}`;
  }
}
