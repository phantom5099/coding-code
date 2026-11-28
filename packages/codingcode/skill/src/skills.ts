import { Layer, Effect } from 'effect';
import { normalizePath, type ConfigScope } from '@codingcode/util';
import { discoverSkillDirs, readSkillBody } from './source.js';
import { loadSkill } from './loader.js';
import type { Skill } from './types.js';
import { SkillService } from './port.js';

function scopeKey(scope: ConfigScope): string {
  return scope.kind === 'global' ? 'global' : `project:${normalizePath(scope.projectPath)}`;
}

export const SkillLayer = Layer.effect(
  SkillService,
  Effect.sync(() => {
    const cache = new Map<string, Skill[]>();

    function readAll(scope: ConfigScope): Skill[] {
      const key = scopeKey(scope);
      const cached = cache.get(key);
      if (cached) return cached;
      const skills: Skill[] = [];
      for (const dir of discoverSkillDirs(scope)) {
        const skill = loadSkill(dir);
        if (skill) skills.push(skill);
      }
      cache.set(key, skills);
      return skills;
    }

    return {
      getAll: (scope: ConfigScope) => Effect.sync(() => readAll(scope)),
      readContent: (skillPath: string) => Effect.sync(() => readSkillBody(skillPath)),
    };
  })
);
