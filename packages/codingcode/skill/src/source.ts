import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { parse as parseYaml } from 'yaml';
import { getGlobalDir, CODINGCODE_DIRNAME, type ConfigScope, type ConfigSource } from '@codingcode/util';

interface SkillFrontMatter {
  readonly name?: string;
  readonly description?: string;
}

export interface SkillDirectory {
  readonly dirPath: string;
  readonly name: string;
  readonly source: ConfigSource;
}

function scanSkillDirs(baseDir: string, source: ConfigSource): SkillDirectory[] {
  const dirs: SkillDirectory[] = [];
  if (!existsSync(baseDir)) return dirs;
  for (const entry of readdirSync(baseDir)) {
    const dirPath = join(baseDir, entry);
    if (statSync(dirPath).isDirectory()) {
      dirs.push({ dirPath, name: entry, source });
    }
  }
  return dirs;
}

/** `~/.codingcode/skills/` —— 全局 skill 目录 */
export function discoverGlobalSkillDirs(): SkillDirectory[] {
  return scanSkillDirs(join(getGlobalDir(), 'skills'), 'global');
}

/** `<projectRoot>/.codingcode/skills/` —— 项目级 skill 目录 */
export function discoverProjectSkillDirs(projectRoot: string): SkillDirectory[] {
  return scanSkillDirs(join(projectRoot, CODINGCODE_DIRNAME, 'skills'), 'project');
}

export function discoverSkillDirs(scope: ConfigScope): SkillDirectory[] {
  if (scope.kind === 'global') return discoverGlobalSkillDirs();
  return [...discoverGlobalSkillDirs(), ...discoverProjectSkillDirs(scope.projectPath)];
}

/** 读取 SKILL.md 全文（含 front matter），供拼 skill 提示块使用。 */
export function readSkillBody(skillPath: string): string {
  return readFileSync(skillPath, 'utf8');
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

  const parsed = parseYaml(match[1]!);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { name: basename(dirPath), description: '' };
  }
  const frontMatter = parsed as Record<string, unknown>;
  return {
    name: typeof frontMatter.name === 'string' ? frontMatter.name : undefined,
    description: typeof frontMatter.description === 'string' ? frontMatter.description : undefined,
  };
}
