import { resolve } from 'path';
import type { Skill } from './types.js';
import { readSkillFrontMatter, type SkillDirectory } from './source.js';

export function loadSkill(dir: SkillDirectory): Skill | null {
  const frontMatter = readSkillFrontMatter(dir.dirPath);
  if (!frontMatter) return null;

  return {
    name: frontMatter.name || dir.name,
    description: frontMatter.description || '',
    skillPath: resolve(dir.dirPath, 'SKILL.md'),
    source: dir.source,
  };
}
