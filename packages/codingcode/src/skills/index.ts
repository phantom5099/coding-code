import { Effect } from 'effect';
import { discoverSkillDirs } from './config';
import { loadSkill } from './loader';
import type { Skill, SkillServiceApi } from './types';

export type { Skill } from './types';

export class SkillService extends Effect.Service<SkillService>()('Skill', {
  effect: Effect.gen(function* () {
    const skills = new Map<string, Skill>();
    const _disabled = new Set<string>();

    return {
      loadAll: (projectRoot: string): Effect.Effect<void> =>
        Effect.sync(() => {
          const dirs = discoverSkillDirs(projectRoot);
          for (const { dirPath } of dirs) {
            const skill = loadSkill(dirPath);
            if (skill) {
              skills.set(skill.name, skill);
            }
          }
        }),

      getAll: (): Effect.Effect<readonly Skill[]> =>
        Effect.sync(() => Array.from(skills.values())),

      findByName: (name: string): Effect.Effect<Skill | undefined> =>
        Effect.sync(() => {
          if (_disabled.has(name)) return undefined;
          return skills.get(name);
        }),

      /** Parse @skill-name from query, return matching Skill */
      select: (query: string): Effect.Effect<Skill | undefined> =>
        Effect.sync(() => {
          const match = query.match(/^@([a-zA-Z0-9-]+)(?:\s+|$)/);
          if (!match) return undefined;
          const name = match[1];
          if (_disabled.has(name)) return undefined;
          return skills.get(name);
        }),

      /** Reserved: implicit activation via custom matcher (e.g. LLM-based) */
      selectImplicit: (
        query: string,
        matcher: (all: readonly Skill[], q: string) => Effect.Effect<string | undefined>,
      ): Effect.Effect<Skill | undefined> =>
        Effect.gen(function* () {
          const all = Array.from(skills.values()).filter(s => !_disabled.has(s.name));
          const name = yield* matcher(all, query);
          if (!name) return undefined;
          if (_disabled.has(name)) return undefined;
          return skills.get(name);
        }),

      /** Strip @skill-name prefix from query, returning [skill, actualQuery] */
      extractSkill: (query: string): Effect.Effect<[Skill | undefined, string]> =>
        Effect.gen(function* () {
          const skill = yield* Effect.sync(() => {
            const match = query.match(/^@([a-zA-Z0-9-]+)(?:\s+|$)/);
            if (!match) return undefined;
            const name = match[1];
            if (_disabled.has(name)) return undefined;
            return skills.get(name);
          });
          const actualQuery = query.replace(/^@[a-zA-Z0-9-]+\s*/, '');
          return [skill, actualQuery];
        }),

      disableSkill: (name: string): Effect.Effect<void> =>
        Effect.sync(() => { _disabled.add(name); }),

      enableSkill: (name: string): Effect.Effect<void> =>
        Effect.sync(() => { _disabled.delete(name); }),

      listWithStatus: (): Effect.Effect<readonly { name: string; description: string; enabled: boolean }[]> =>
        Effect.sync(() =>
          Array.from(skills.values()).map(s => ({
            name: s.name,
            description: s.description,
            enabled: !_disabled.has(s.name),
          })),
        ),
    };
  }),
}) {}
