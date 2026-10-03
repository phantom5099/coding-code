import type { Hono } from 'hono';
import { Effect, ManagedRuntime } from 'effect';
import { SkillService } from '../../skills/port.js';
import { isGlobalCwd, resolveCwd } from '../cwd.js';
import { discoverGlobalSkillDirs, discoverProjectSkillDirs } from '../../skills/source.js';
import { createRunWithLayer } from '../util.js';

type ManagedRt = ManagedRuntime.ManagedRuntime<any, any>;

export function registerSkillsSettingsRoutes(router: Hono, rt: ManagedRt): void {
  const runWithLayer = createRunWithLayer(rt);

  router.get('/api/settings/skills', async (c) => {
    const rawCwd = c.req.query('cwd');
    if (isGlobalCwd(rawCwd)) {
      const cwd = resolveCwd(rawCwd);
      const result = await runWithLayer(
        Effect.gen(function* () {
          const skill = yield* SkillService;
          return yield* skill.getAll(cwd);
        })
      );
      const skills = result.ok ? result.value : [];
      return c.json(
        skills.map((s) => ({
          ...s,
          source: 'global' as const,
        }))
      );
    }
    const cwd = resolveCwd(rawCwd);
    const globalDirs = discoverGlobalSkillDirs();
    const projectDirs = discoverProjectSkillDirs(cwd);
    const globalNames = new Set(globalDirs.map((d) => d.name));
    const projectNames = new Set(projectDirs.map((d) => d.name));
    const result = await runWithLayer(
      Effect.gen(function* () {
        const skill = yield* SkillService;
        return yield* skill.getAll(cwd);
      })
    );
    const skills = result.ok ? result.value : [];
    return c.json(
      skills.map((s) => {
        const isFromProject = projectNames.has(s.name);
        const isFromGlobal = globalNames.has(s.name);
        const hasProjectOverride = isFromProject && isFromGlobal;
        return {
          ...s,
          source: isFromProject ? 'project' : 'global',
          hasProjectOverride,
        };
      })
    );
  });
}
