import { Effect } from 'effect';
import { discoverSkillDirs } from './source.js';
import { loadSkill } from './loader.js';
import type { Skill } from './types.js';

export class SkillService extends Effect.Service<SkillService>()('Skill', {
  effect: Effect.gen(function* () {
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

      findByName: (projectPath: string, name: string) =>
        Effect.sync(() => readAll(projectPath).find((s) => s.name === name)),

      select: (projectPath: string, query: string) =>
        Effect.sync(() => {
          const match = query.match(/^@([a-zA-Z0-9-]+)(?:\s+|$)/);
          if (!match) return undefined;
          const name = match[1]!;
          return readAll(projectPath).find((s) => s.name === name);
        }),

      selectImplicit: (
        projectPath: string,
        query: string,
        matcher: (all: readonly Skill[], q: string) => Effect.Effect<string | undefined>
      ): Effect.Effect<Skill | undefined> =>
        Effect.gen(function* () {
          const all = readAll(projectPath);
          const name = yield* matcher(all, query);
          if (!name) return undefined;
          return all.find((s) => s.name === name);
        }),

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

      evictProject: (projectPath: string) =>
        Effect.sync(() => {
          cachedByProject.delete(projectPath);
        }),
    };
  }),
}) {}
