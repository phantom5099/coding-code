import * as HttpRouter from '@effect/platform/HttpRouter';
import { Effect } from 'effect';
import { SkillService } from '@codingcode/skill';
import { resolveConfigScope } from '../cwd.js';
import { json, query, type Handler, type Router } from '../handler.js';

const listSkills: Handler = Effect.gen(function* () {
  const { cwd: rawCwd } = yield* query;
  const skill = yield* SkillService;
  return json(yield* skill.getAll(resolveConfigScope(rawCwd)));
});

export const addSkillsSettingsRoutes = (router: Router): Router =>
  router.pipe(HttpRouter.get('/api/settings/skills', listSkills));
