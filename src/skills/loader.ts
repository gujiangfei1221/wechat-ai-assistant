import fs from "node:fs";
import path from "node:path";

// ==================== Skills 动态加载系统（升级版） ====================
// 兼容两种模式：
// 1. 扁平模式：workspace/skills/my-skill.md（你自己写的简单 Skill）
// 2. 目录模式：workspace/skills/weather/SKILL.md（OpenClaw / ClawHub 标准格式）
//    支持子目录中的 scripts/ references/ assets/

export interface Skill {
  name: string;
  description: string;
  content: string;
  filePath: string;
  /** 技能所在目录（用于引用 scripts/references/assets） */
  skillDir: string;
  /** 是否有附带脚本 */
  hasScripts: boolean;
  /** 是否有参考文档 */
  hasReferences: boolean;
}

/**
 * 从 workspace/skills/ 目录加载所有 Skill
 *
 * 扫描规则（优先级）：
 * 1. 子目录下的 SKILL.md（ClawHub / OpenClaw 标准格式）
 * 2. 顶层的 *.md 文件（自定义简易 Skill）
 */
export function loadSkills(skillsDir?: string): Skill[] {
  const dir = skillsDir || path.resolve(process.env.WORKSPACE_DIR || ".", "skills");

  if (!fs.existsSync(dir)) {
    console.log("[Skills] 技能目录不存在，跳过加载:", dir);
    return [];
  }

  const skills: Skill[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      // 目录模式：扫描子目录下的 SKILL.md
      const skillMdPath = path.join(dir, entry.name, "SKILL.md");
      if (fs.existsSync(skillMdPath)) {
        const skill = parseSkillFile(skillMdPath, entry.name);
        if (skill) {
          // 检测附带资源
          const skillDir = path.join(dir, entry.name);
          skill.skillDir = skillDir;
          skill.hasScripts = fs.existsSync(path.join(skillDir, "scripts"));
          skill.hasReferences = fs.existsSync(path.join(skillDir, "references"));
          skills.push(skill);
        }
      }
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      // 扁平模式：顶层 .md 文件
      const filePath = path.join(dir, entry.name);
      const name = path.basename(entry.name, ".md");
      const skill = parseSkillFile(filePath, name);
      if (skill) skills.push(skill);
    }
  }

  console.log(`[Skills] 共加载 ${skills.length} 个技能:`);
  for (const s of skills) {
    const extras: string[] = [];
    if (s.hasScripts) extras.push("📜scripts");
    if (s.hasReferences) extras.push("📚refs");
    console.log(`  - ${s.name}${s.description ? `: ${s.description.substring(0, 60)}...` : ""}${extras.length ? ` [${extras.join(", ")}]` : ""}`);
  }

  return skills;
}

/**
 * 解析单个 Skill 文件
 */
function parseSkillFile(filePath: string, fallbackName: string): Skill | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    let name = fallbackName;
    let description = "";
    let content = raw;

    // 解析 YAML frontmatter
    const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (frontmatterMatch) {
      const meta = frontmatterMatch[1];
      content = frontmatterMatch[2].trim();

      const nameMatch = meta.match(/name:\s*["']?([^"'\n]+)["']?/);
      if (nameMatch) name = nameMatch[1].trim();

      // description 可能跨多行（用引号包裹）
      const descMatch = meta.match(/description:\s*["']?([\s\S]*?)["']?\s*(?:\n\w|\n---)/);
      if (descMatch) {
        description = descMatch[1].trim().replace(/\s+/g, " ");
      } else {
        const simpleDescMatch = meta.match(/description:\s*["']?(.+?)["']?\s*$/m);
        if (simpleDescMatch) description = simpleDescMatch[1].trim();
      }
    }

    return {
      name,
      description,
      content,
      filePath,
      skillDir: path.dirname(filePath),
      hasScripts: false,
      hasReferences: false,
    };
  } catch (error: any) {
    console.error(`[Skills] 解析失败 ${filePath}: ${error.message}`);
    return null;
  }
}

/**
 * 将加载的 Skills 拼接成 System Prompt 片段
 *
 * 注意：这里使用 OpenClaw 的"渐进式披露"策略——
 * System Prompt 里只注入 name + description（第一层），
 * 正文内容只在 AI 明确判断需要时才加载。
 * 但由于我们的上下文窗口相对充裕，对于简单 Skill 直接注入全文。
 */
export function buildSkillsPrompt(skills: Skill[]): string {
  if (skills.length === 0) return "";

  const sections = skills.map((s) => {
    // 如果 Skill 正文超过 2000 字符，只注入摘要，避免爆上下文
    if (s.content.length > 2000) {
      let summary = `### 技能: ${s.name}`;
      if (s.description) summary += `\n${s.description}`;
      summary += `\n> 完整指令文件: ${s.filePath}（可用 read_file 工具查看详细内容）`;
      if (s.hasScripts) summary += `\n> 附带脚本: ${s.skillDir}/scripts/`;
      if (s.hasReferences) summary += `\n> 参考文档: ${s.skillDir}/references/`;
      return summary;
    }

    // 短 Skill 直接全文注入
    return `### 技能: ${s.name}${s.description ? ` (${s.description})` : ""}\n${s.content}`;
  });

  return `\n\n## 已加载的技能
以下是你已掌握的专项技能，请在相关场景中灵活运用。
对于标记"完整指令文件"的技能，请在需要时用 read_file 工具查看完整说明。

${sections.join("\n\n")}`;
}

/**
 * 热重载 Skills（运行时重新扫描目录）
 */
export function reloadSkills(skillsDir?: string): Skill[] {
  console.log("[Skills] 热重载技能...");
  return loadSkills(skillsDir);
}
