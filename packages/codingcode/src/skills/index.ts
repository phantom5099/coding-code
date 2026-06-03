import { Effect } from 'effect';
import { discoverSkillDirs } from './config';
import { loadSkill } from './loader';
import { getWorkspaceCwd } from '../core/workspace';
import type { Skill } from './types';

export type { Skill } from './types';

export class SkillService extends Effect.Service<SkillService>()('Skill', {
  effect: Effect.gen(function* () {
    const _disabled = new Set<string>();

    function readAll(): Skill[] {
      const dirs = discoverSkillDirs(getWorkspaceCwd());
      const skills: Skill[] = [];
      for (const { dirPath } of dirs) {
        const skill = loadSkill(dirPath);
        if (skill) skills.push(skill);
      }
      return skills;
    }

    return {
      getAll: (): Effect.Effect<readonly Skill[]> =>
        Effect.sync(() => readAll().filter((s) => !_disabled.has(s.name))),

      findByName: (name: string): Effect.Effect<Skill | undefined> =>
        Effect.sync(() => {
          if (_disabled.has(name)) return undefined;
          return readAll().find((s) => s.name === name);
        }),

      select: (query: string): Effect.Effect<Skill | undefined> =>
        Effect.sync(() => {
          const match = query.match(/^@([a-zA-Z0-9-]+)(?:\s+|$)/);
          if (!match) return undefined;
          const name = match[1];
          if (_disabled.has(name)) return undefined;
          return readAll().find((s) => s.name === name);
        }),

      selectImplicit: (
        query: string,
        matcher: (all: readonly Skill[], q: string) => Effect.Effect<string | undefined>
      ): Effect.Effect<Skill | undefined> =>
        Effect.gen(function* () {
          const all = readAll().filter((s) => !_disabled.has(s.name));
          const name = yield* matcher(all, query);
          if (!name) return undefined;
          if (_disabled.has(name)) return undefined;
          return all.find((s) => s.name === name);
        }),

      extractSkill: (query: string): Effect.Effect<[Skill | undefined, string]> =>
        Effect.gen(function* () {
          const skill = yield* Effect.sync(() => {
            const match = query.match(/^@([a-zA-Z0-9-]+)(?:\s+|$)/);
            if (!match) return undefined;
            const name = match[1];
            if (_disabled.has(name)) return undefined;
            return readAll().find((s) => s.name === name);
          });
          const actualQuery = query.replace(/^@[a-zA-Z0-9-]+\s*/, '');
          return [skill, actualQuery];
        }),

      disableSkill: (name: string): Effect.Effect<void> =>
        Effect.sync(() => {
          _disabled.add(name);
        }),

      enableSkill: (name: string): Effect.Effect<void> =>
        Effect.sync(() => {
          _disabled.delete(name);
        }),

      listWithStatus: (): Effect.Effect<
        readonly { name: string; description: string; enabled: boolean }[]
      > =>
        Effect.sync(() =>
          readAll().map((s) => ({
            name: s.name,
            description: s.description,
            enabled: !_disabled.has(s.name),
          }))
        ),
    };
  }),
}) {}
