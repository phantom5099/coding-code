import type { Hono } from 'hono';
import { dirname } from 'path';
import { Effect, ManagedRuntime } from 'effect';
import { SkillService } from '../../skills/port.js';
import { isGlobalCwd, resolveCwd } from '../cwd.js';
import { discoverGlobalSkillDirs } from '../../skills/source.js';
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
    const globalDirPaths = new Set(discoverGlobalSkillDirs().map((d) => d.dirPath));
    const result = await runWithLayer(
      Effect.gen(function* () {
        const skill = yield* SkillService;
        return yield* skill.getAll(cwd);
      })
    );
    const skills = result.ok ? result.value : [];
    // 按 SKILL.md 所在目录判定来源；同名同时存在于全局与项目时，两条各自标注真实来源
    return c.json(
      skills.map((s) => ({
        ...s,
        source: globalDirPaths.has(dirname(s.skillPath)) ? ('global' as const) : ('project' as const),
      }))
    );
  });
}
