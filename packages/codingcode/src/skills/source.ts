import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { createDisabledStore } from '@codingcode/infra/disabled-store';

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

// ---- Skill disabled state ----

const skillDisabledStore = createDisabledStore({
  globalKeyPath: ['skills', 'disabledSkills'],
  getGlobalConfigDir: () => join(homedir(), '.codingcode'),
});
export const getGlobalSkillDisabledState = skillDisabledStore.getGlobal;
export const setGlobalSkillDisabledState = skillDisabledStore.setGlobal;
export const getProjectSkillDisabledState = skillDisabledStore.getProject;
export const setProjectSkillDisabledState = skillDisabledStore.setProject;
export const resetProjectSkillDisabledState = skillDisabledStore.resetProject;
export const resolveSkillDisabled = skillDisabledStore.resolve;

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
