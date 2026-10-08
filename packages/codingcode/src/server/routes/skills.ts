import * as HttpRouter from '@effect/platform/HttpRouter';
import { dirname } from 'path';
import { Effect } from 'effect';
import { SkillService } from '../../skills/port.js';
import { isGlobalCwd, resolveCwd } from '../cwd.js';
import { discoverGlobalSkillDirs } from '../../skills/source.js';
import { json, query, type Handler, type Router } from '../handler.js';

const listSkills: Handler = Effect.gen(function* () {
  const { cwd: rawCwd } = yield* query;
  const skill = yield* SkillService;

  if (isGlobalCwd(rawCwd)) {
    const skills = yield* skill.getAll(resolveCwd(rawCwd));
    return json(skills.map((s) => ({ ...s, source: 'global' as const })));
  }

  const cwd = resolveCwd(rawCwd);
  const globalDirPaths = new Set(discoverGlobalSkillDirs().map((d) => d.dirPath));
  const skills = yield* skill.getAll(cwd);
  return json(
    skills.map((s) => ({
      ...s,
      source: globalDirPaths.has(dirname(s.skillPath))
        ? ('global' as const)
        : ('project' as const),
    }))
  );
});

export const addSkillsSettingsRoutes = (router: Router): Router =>
  router.pipe(HttpRouter.get('/api/settings/skills', listSkills));
