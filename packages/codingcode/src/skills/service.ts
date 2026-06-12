import { Effect } from 'effect';
import { discoverSkillDirs, resolveSkillDisabled, setProjectSkillDisabledState } from './config.js';
import { loadSkill } from './loader.js';
import type { Skill } from './types.js';

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

function filterEnabled(projectPath: string, skills: Skill[]): Skill[] {
  return skills.filter((s) => !resolveSkillDisabled(projectPath, s.name));
}

export class SkillService extends Effect.Service<SkillService>()('Skill', {
  effect: Effect.gen(function* () {
    return {
      getAll: (projectPath: string) => Effect.sync(() => filterEnabled(projectPath, readAll(projectPath))),

      findByName: (projectPath: string, name: string) => Effect.sync(() => {
        if (resolveSkillDisabled(projectPath, name)) return undefined;
        return readAll(projectPath).find((s) => s.name === name);
      }),

      select: (projectPath: string, query: string) => Effect.sync(() => {
        const match = query.match(/^@([a-zA-Z0-9-]+)(?:\s+|$)/);
        if (!match) return undefined;
        const name = match[1]!;
        if (resolveSkillDisabled(projectPath, name)) return undefined;
        return readAll(projectPath).find((s) => s.name === name);
      }),

      selectImplicit: (
        projectPath: string,
        query: string,
        matcher: (all: readonly Skill[], q: string) => Effect.Effect<string | undefined>
      ): Effect.Effect<Skill | undefined> =>
        Effect.gen(function* () {
          const all = filterEnabled(projectPath, readAll(projectPath));
          const name = yield* matcher(all, query);
          if (!name) return undefined;
          if (resolveSkillDisabled(projectPath, name)) return undefined;
          return all.find((s) => s.name === name);
        }),

      extractSkill: (projectPath: string, query: string) => Effect.sync(() => {
        const match = query.match(/^@([a-zA-Z0-9-]+)(?:\s+|$)/);
        let skill: Skill | undefined;
        if (match) {
          const name = match[1]!;
          if (!resolveSkillDisabled(projectPath, name)) {
            skill = readAll(projectPath).find((s) => s.name === name);
          }
        }
        const actualQuery = query.replace(/^@[a-zA-Z0-9-]+\s*/, '');
        return [skill, actualQuery] as [Skill | undefined, string];
      }),

      disableSkill: (projectPath: string, name: string) => Effect.sync(() => setProjectSkillDisabledState(projectPath, name, true)),

      enableSkill: (projectPath: string, name: string) => Effect.sync(() => setProjectSkillDisabledState(projectPath, name, false)),

      listWithStatus: (projectPath: string) => Effect.sync(() =>
        readAll(projectPath).map((s) => ({
          name: s.name,
          description: s.description,
          enabled: !resolveSkillDisabled(projectPath, s.name),
        }))
      ),

      evictProject: (projectPath: string) => Effect.sync(() => { cachedByProject.delete(projectPath); }),
    };
  }),
}) {}
