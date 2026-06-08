import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

interface SkillFrontMatter {
  name: string;
  description: string;
  [key: string]: unknown;
}

export interface SkillDirectory {
  /** Skill root directory path */
  dirPath: string;
  /** Skill name (from front matter or directory name) */
  name: string;
}

export function discoverSkillDirs(projectRoot: string): SkillDirectory[] {
  const dirs: SkillDirectory[] = [];

  // Global skills (~/.codingcode/skills/) — loaded first, project overrides
  const globalSkillsDir = join(homedir(), '.codingcode', 'skills');
  if (existsSync(globalSkillsDir)) {
    for (const entry of readdirSync(globalSkillsDir)) {
      const dirPath = join(globalSkillsDir, entry);
      if (statSync(dirPath).isDirectory()) {
        dirs.push({ dirPath, name: entry });
      }
    }
  }

  // Project-level skills (.codingcode/skills/) — loaded after, takes priority
  const projectSkillsDir = join(projectRoot, '.codingcode', 'skills');
  if (existsSync(projectSkillsDir)) {
    for (const entry of readdirSync(projectSkillsDir)) {
      const dirPath = join(projectSkillsDir, entry);
      if (statSync(dirPath).isDirectory()) {
        dirs.push({ dirPath, name: entry });
      }
    }
  }

  return dirs;
}

/** Parse SKILL.md: returns { frontMatter, body } */
export function readSkillMd(
  dirPath: string
): { frontMatter: SkillFrontMatter; body: string } | null {
  const skillMdPath = join(dirPath, 'SKILL.md');
  if (!existsSync(skillMdPath)) return null;

  const raw = readFileSync(skillMdPath, 'utf8');

  // Parse YAML front matter between --- delimiters
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    // No front matter: use directory name as skill name
    return {
      frontMatter: { name: basename(dirPath), description: '' },
      body: raw.trim(),
    };
  }

  const frontMatter = parseYaml(match[1]!) as SkillFrontMatter;
  const body = match[2]!.trim();

  return { frontMatter, body };
}

export function readFileContent(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

export function getFilesInDir(dirPath: string): string[] {
  if (!existsSync(dirPath)) return [];
  return readdirSync(dirPath)
    .map((f) => join(dirPath, f))
    .filter((f) => statSync(f).isFile());
}

export function getMimeType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
    tsx: 'text/typescript-jsx',
    ts: 'text/typescript',
    js: 'text/javascript',
    json: 'application/json',
    py: 'text/x-python',
    html: 'text/html',
    css: 'text/css',
    md: 'text/markdown',
    txt: 'text/plain',
  };
  return map[ext ?? ''] ?? 'application/octet-stream';
}

// ---- 全局级 Skill disabled 状态：持久化到 ~/.codingcode/config.yaml ----

export function getGlobalSkillDisabledState(skillName: string): boolean {
  try {
    const p = join(homedir(), '.codingcode', 'config.yaml');
    if (!existsSync(p)) return false;
    const raw = readFileSync(p, 'utf8');
    const config = parseYaml(raw) as any;
    const disabled = config.skills?.disabledSkills as Record<string, boolean>;
    return disabled?.[skillName] ?? false;
  } catch {
    return false;
  }
}

export function setGlobalSkillDisabledState(skillName: string, disabled: boolean): void {
  const dir = join(homedir(), '.codingcode');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = join(dir, 'config.yaml');
  const existing: Record<string, unknown> = existsSync(p)
    ? (parseYaml(readFileSync(p, 'utf8')) as Record<string, unknown>)
    : {};
  const skills = (existing.skills as Record<string, unknown>) ?? {};
  const disabledSkills = (skills.disabledSkills as Record<string, boolean>) ?? {};
  disabledSkills[skillName] = disabled;
  skills.disabledSkills = disabledSkills;
  existing.skills = skills;
  writeFileSync(p, stringifyYaml(existing), 'utf8');
}

// ---- 项目级 Skill disabled 状态：持久化到 .codingcode/config.yaml ----

export function getProjectSkillDisabledState(
  projectRoot: string,
  skillName: string
): boolean | undefined {
  const p = join(projectRoot, '.codingcode', 'config.yaml');
  if (!existsSync(p)) return undefined;
  try {
    const raw = readFileSync(p, 'utf8');
    const config = parseYaml(raw) as any;
    const disabled = config.skills?.disabledSkills as Record<string, boolean>;
    return disabled?.[skillName];
  } catch {
    return undefined;
  }
}

export function setProjectSkillDisabledState(
  projectRoot: string,
  skillName: string,
  disabled: boolean
): void {
  const dir = join(projectRoot, '.codingcode');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = join(dir, 'config.yaml');
  const existing: Record<string, unknown> = existsSync(p)
    ? (parseYaml(readFileSync(p, 'utf8')) as Record<string, unknown>)
    : {};
  const skills = (existing.skills as Record<string, unknown>) ?? {};
  const disabledSkills = (skills.disabledSkills as Record<string, boolean>) ?? {};
  disabledSkills[skillName] = disabled;
  skills.disabledSkills = disabledSkills;
  existing.skills = skills;
  writeFileSync(p, stringifyYaml(existing), 'utf8');
}

export function resetProjectSkillDisabledState(projectRoot: string, skillName: string): void {
  const p = join(projectRoot, '.codingcode', 'config.yaml');
  if (!existsSync(p)) return;
  const existing: Record<string, unknown> = parseYaml(readFileSync(p, 'utf8')) as Record<
    string,
    unknown
  >;
  const skills = (existing.skills as Record<string, unknown>) ?? {};
  const disabledSkills = skills.disabledSkills as Record<string, boolean>;
  if (disabledSkills) {
    delete disabledSkills[skillName];
    skills.disabledSkills = disabledSkills;
  }
  existing.skills = skills;
  writeFileSync(p, stringifyYaml(existing), 'utf8');
}

// 解析最终生效的 Skill disabled 状态：项目级 > 全局级
export function resolveSkillDisabled(projectRoot: string, skillName: string): boolean {
  const projectVal = getProjectSkillDisabledState(projectRoot, skillName);
  if (projectVal !== undefined) return projectVal;
  return getGlobalSkillDisabledState(skillName);
}

// ---- 辅助函数：分别获取全局/项目级 Skill 目录 ----

export function discoverGlobalSkillDirs(): SkillDirectory[] {
  const dirs: SkillDirectory[] = [];
  const globalSkillsDir = join(homedir(), '.codingcode', 'skills');
  if (existsSync(globalSkillsDir)) {
    for (const entry of readdirSync(globalSkillsDir)) {
      const dirPath = join(globalSkillsDir, entry);
      if (statSync(dirPath).isDirectory()) {
        dirs.push({ dirPath, name: entry });
      }
    }
  }
  return dirs;
}

export function discoverProjectSkillDirs(projectRoot: string): SkillDirectory[] {
  const dirs: SkillDirectory[] = [];
  const projectSkillsDir = join(projectRoot, '.codingcode', 'skills');
  if (existsSync(projectSkillsDir)) {
    for (const entry of readdirSync(projectSkillsDir)) {
      const dirPath = join(projectSkillsDir, entry);
      if (statSync(dirPath).isDirectory()) {
        dirs.push({ dirPath, name: entry });
      }
    }
  }
  return dirs;
}
