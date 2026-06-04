import { Effect } from 'effect';
import { discoverSkillDirs } from './config';
import { loadSkill } from './loader';
import type { Skill } from './types';

export type { Skill } from './types';

export class SkillService extends Effect.Service<SkillService>()('Skill', {
  effect: Effect.gen(function* () {
    const disabledByProject = new Map<string, Set<string>>();
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

    function getDisabled(projectPath: string): Set<string> {
      let set = disabledByProject.get(projectPath);
      if (!set) {
        set = new Set();
        disabledByProject.set(projectPath, set);
      }
      return set;
    }

    return {
      getAll: (projectPath: string): Effect.Effect<readonly Skill[]> =>
        Effect.sync(() =>
          readAll(projectPath).filter((s) => !getDisabled(projectPath).has(s.name))
        ),

      findByName: (projectPath: string, name: string): Effect.Effect<Skill | undefined> =>
        Effect.sync(() => {
          if (getDisabled(projectPath).has(name)) return undefined;
          return readAll(projectPath).find((s) => s.name === name);
        }),

      select: (projectPath: string, query: string): Effect.Effect<Skill | undefined> =>
        Effect.sync(() => {
          const match = query.match(/^@([a-zA-Z0-9-]+)(?:\s+|$)/);
          if (!match) return undefined;
          const name = match[1]!;
          if (getDisabled(projectPath).has(name)) return undefined;
          return readAll(projectPath).find((s) => s.name === name);
        }),

      selectImplicit: (
        projectPath: string,
        query: string,
        matcher: (all: readonly Skill[], q: string) => Effect.Effect<string | undefined>
      ): Effect.Effect<Skill | undefined> =>
        Effect.gen(function* () {
          const all = readAll(projectPath).filter((s) => !getDisabled(projectPath).has(s.name));
          const name = yield* matcher(all, query);
          if (!name) return undefined;
          if (getDisabled(projectPath).has(name)) return undefined;
          return all.find((s) => s.name === name);
        }),

      extractSkill: (
        projectPath: string,
        query: string
      ): Effect.Effect<[Skill | undefined, string]> =>
        Effect.gen(function* () {
          const skill = yield* Effect.sync(() => {
            const match = query.match(/^@([a-zA-Z0-9-]+)(?:\s+|$)/);
            if (!match) return undefined;
            const name = match[1]!;
            if (getDisabled(projectPath).has(name)) return undefined;
            return readAll(projectPath).find((s) => s.name === name);
          });
          const actualQuery = query.replace(/^@[a-zA-Z0-9-]+\s*/, '');
          return [skill, actualQuery];
        }),

      disableSkill: (projectPath: string, name: string): Effect.Effect<void> =>
        Effect.sync(() => {
          getDisabled(projectPath).add(name);
        }),

      enableSkill: (projectPath: string, name: string): Effect.Effect<void> =>
        Effect.sync(() => {
          getDisabled(projectPath).delete(name);
        }),

      listWithStatus: (
        projectPath: string
      ): Effect.Effect<readonly { name: string; description: string; enabled: boolean }[]> =>
        Effect.sync(() =>
          readAll(projectPath).map((s) => ({
            name: s.name,
            description: s.description,
            enabled: !getDisabled(projectPath).has(s.name),
          }))
        ),

      evictProject: (projectPath: string): Effect.Effect<void> =>
        Effect.sync(() => {
          cachedByProject.delete(projectPath);
        }),
    };
  }),
}) {}
