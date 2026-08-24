import { basename, resolve } from 'path';
import type { Skill } from './types.js';
import { readSkillFrontMatter } from './source.js';

export function loadSkill(dirPath: string): Skill | null {
  const frontMatter = readSkillFrontMatter(dirPath);
  if (!frontMatter) return null;

  return {
    name: frontMatter.name || basename(dirPath),
    description: frontMatter.description || '',
    skillPath: resolve(dirPath, 'SKILL.md'),
  };
}
