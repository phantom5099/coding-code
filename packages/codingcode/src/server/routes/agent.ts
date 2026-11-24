import * as HttpRouter from '@effect/platform/HttpRouter';
import { Effect } from 'effect';
import {
  loadConfig,
  updateMaxSteps,
  updateMaxStopContinuations,
  updateContextCompactionModel,
  updatePermissionMode,
} from '../../infra/config.js';
import { isPermissionMode } from '../../approval/types.js';
import { AgentError } from '../../util/error.js';
import { json, readJson, type Handler, type Router } from '../handler.js';
import { ASK_BEFORE_EXEC_PERMISSION_MODE } from '../../util/enums.js';

function readAgentConfig() {
  const cfg = loadConfig();
  return {
    maxSteps: cfg.maxSteps,
    maxStopContinuations: cfg.maxStopContinuations,
    permissionMode: isPermissionMode(cfg.permissionMode)
      ? cfg.permissionMode
      : ASK_BEFORE_EXEC_PERMISSION_MODE,
  };
}

const getConfig: Handler = Effect.sync(() => json(readAgentConfig()));

const putConfig: Handler = Effect.gen(function* () {
  const body = yield* readJson<{
    maxSteps?: number;
    maxStopContinuations?: number;
    permissionMode?: string;
  }>();

  if (body.permissionMode !== undefined && !isPermissionMode(body.permissionMode)) {
    return yield* Effect.fail(
      new AgentError('CONFIG_INVALID', `Invalid permissionMode: ${body.permissionMode}`)
    );
  }

  if (body.maxSteps !== undefined) updateMaxSteps(body.maxSteps);
  if (body.maxStopContinuations !== undefined) updateMaxStopContinuations(body.maxStopContinuations);
  if (body.permissionMode !== undefined) updatePermissionMode(body.permissionMode);
  return json(readAgentConfig());
});

const setCompactionModel: Handler = Effect.gen(function* () {
  const body = yield* readJson<{ compactionModel: string }>();
  updateContextCompactionModel(body.compactionModel);
  return json({ compactionModel: body.compactionModel });
});

export const addAgentSettingsRoutes = (router: Router): Router =>
  router.pipe(
    HttpRouter.get('/api/settings/agent/config', getConfig),
    HttpRouter.post('/api/settings/agent/config', putConfig),
    HttpRouter.post('/api/settings/context/compaction-model', setCompactionModel)
  );
