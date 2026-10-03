import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { parse as parseYaml } from 'yaml';
import { getGlobalDir, CODINGCODE_DIRNAME } from '../core/path.js';

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

/** 全局在前、项目在后：同名 skill 由后者覆盖（消费方按 name 去重，后写者胜）。 */
export function discoverSkillDirs(projectRoot: string): SkillDirectory[] {
  return [...discoverGlobalSkillDirs(), ...discoverProjectSkillDirs(projectRoot)];
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

/** `~/.codingcode/skills/` —— 先加载，同名的项目级 skill 会覆盖它 */
export function discoverGlobalSkillDirs(): SkillDirectory[] {
  const dirs: SkillDirectory[] = [];
  const globalSkillsDir = join(getGlobalDir(), 'skills');
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

/** `<projectRoot>/.codingcode/skills/` —— 后加载，优先级更高 */
export function discoverProjectSkillDirs(projectRoot: string): SkillDirectory[] {
  const dirs: SkillDirectory[] = [];
  const projectSkillsDir = join(projectRoot, CODINGCODE_DIRNAME, 'skills');
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
