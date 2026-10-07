import { Layer, Effect } from 'effect';
import { discoverSkillDirs, readSkillBody } from './source.js';
import { loadSkill } from './loader.js';
import type { Skill } from './types.js';
import { SkillService } from './port.js';

export const SkillLayer = Layer.effect(
  SkillService,
  Effect.gen(function* () {
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

      readContent: (skillPath: string) => Effect.sync(() => readSkillBody(skillPath)),
    };
  })
);
