import * as HttpRouter from '@effect/platform/HttpRouter';
import { Effect } from 'effect';
import { loadConfig, updateAppConfig, updateContextCompactionModel } from '@codingcode/infra';
import { AgentError, isPermissionMode } from '@codingcode/util';
import type { AgentConfigView } from '../dto.js';
import { json, readJson, type Handler, type Router } from '../handler.js';

function readAgentConfig(): AgentConfigView {
  const cfg = loadConfig();
  return {
    maxSteps: cfg.maxSteps,
    maxStopContinuations: cfg.maxStopContinuations,
    permissionMode: cfg.permissionMode,
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

  updateAppConfig({
    ...(body.maxSteps !== undefined ? { maxSteps: body.maxSteps } : {}),
    ...(body.maxStopContinuations !== undefined
      ? { maxStopContinuations: body.maxStopContinuations }
      : {}),
    ...(body.permissionMode !== undefined ? { permissionMode: body.permissionMode } : {}),
  });
  return json(readAgentConfig());
});

const setCompactionModel: Handler = Effect.gen(function* () {
  const body = yield* readJson<{ compactionModel?: unknown }>();
  if (typeof body.compactionModel !== 'string') {
    return yield* Effect.fail(new AgentError('CONFIG_INVALID', 'compactionModel must be a string'));
  }
  updateContextCompactionModel(body.compactionModel);
  return json({ compactionModel: body.compactionModel });
});

export const addAgentSettingsRoutes = (router: Router): Router =>
  router.pipe(
    HttpRouter.get('/api/settings/agent/config', getConfig),
    HttpRouter.post('/api/settings/agent/config', putConfig),
    HttpRouter.post('/api/settings/context/compaction-model', setCompactionModel)
  );
