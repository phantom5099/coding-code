import { Layer, Effect } from 'effect';
import { discoverSkillDirs } from './source.js';
import { loadSkill } from './loader.js';
import type { Skill } from '../contracts/skill.js';
import { SkillService } from './port.js';

export const SkillLayer = Layer.effect(SkillService, Effect.gen(function* () {
    const cachedByProject = new Map<string, Skill[]>();

    function readAll(projectPath: string): Skill[] {
      const cached = cachedByProject.get(projectPath);
      if (cached) return cached;
      const dirs = discoverSkillDirs(projectPath);
      const skills: Skill[] = [];
      for (const { dirPath } of dirs) {
        const skill = loadSkill(dirPath);
        if (skill) skills.push(skill);
      }
      cachedByProject.set(projectPath, skills);
      return skills;
    }

    return {
      getAll: (projectPath: string) => Effect.sync(() => readAll(projectPath)),

      extractSkill: (projectPath: string, query: string) =>
        Effect.sync(() => {
          const match = query.match(/^@([a-zA-Z0-9-]+)(?:\s+|$)/);
          let skill: Skill | undefined;
          if (match) {
            const name = match[1]!;
            skill = readAll(projectPath).find((s) => s.name === name);
          }
          const actualQuery = query.replace(/^@[a-zA-Z0-9-]+\s*/, '');
          return [skill, actualQuery] as [Skill | undefined, string];
        }),
    };
}));
