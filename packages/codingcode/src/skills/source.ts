import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { parse as parseYaml } from 'yaml';

interface SkillFrontMatter {
  name?: string;
  description?: string;
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

/** Parse only the SKILL.md front matter used for skill discovery. */
export function readSkillFrontMatter(dirPath: string): SkillFrontMatter | null {
  const skillMdPath = join(dirPath, 'SKILL.md');
  if (!existsSync(skillMdPath)) return null;

  const raw = readFileSync(skillMdPath, 'utf8');

  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return { name: basename(dirPath), description: '' };
  }

  const frontMatter = parseYaml(match[1]!) as SkillFrontMatter;
  return {
    name: frontMatter.name,
    description: frontMatter.description,
  };
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
