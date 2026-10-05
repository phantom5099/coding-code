import type { Hono } from 'hono';
import {
  loadConfig,
  updateMaxSteps,
  updateMaxStopContinuations,
  updateContextCompactionModel,
  updateActiveProfile,
  updatePermissionMode,
} from '../../infra/config.js';
import { isAgentProfileName } from '../../agent/profile.js';
import { isPermissionMode } from '../../approval/types.js';
import { errorBody } from '../util.js';

/** config.yaml 的 agent 段；交互/权限模式非法时回落到 build / default */
function readAgentConfig() {
  const cfg = loadConfig();
  return {
    maxSteps: cfg.maxSteps,
    maxStopContinuations: cfg.maxStopContinuations,
    activeProfile: isAgentProfileName(cfg.activeProfile) ? cfg.activeProfile : 'build',
    permissionMode: isPermissionMode(cfg.permissionMode) ? cfg.permissionMode : 'askBeforeExec',
  };
}

export function registerAgentSettingsRoutes(router: Hono): void {
  // ---- Agent config ----
  router.get('/api/settings/agent/config', (c) => {
    return c.json(readAgentConfig());
  });

  router.post('/api/settings/agent/config', async (c) => {
    const body = (await c.req.json()) as {
      maxSteps?: number;
      maxStopContinuations?: number;
      activeProfile?: string;
      permissionMode?: string;
    };
    if (body.activeProfile !== undefined && !isAgentProfileName(body.activeProfile)) {
      return c.json(
        errorBody('CONFIG_INVALID', `Invalid activeProfile: ${body.activeProfile}`),
        400
      );
    }
    if (body.permissionMode !== undefined && !isPermissionMode(body.permissionMode)) {
      return c.json(
        errorBody('CONFIG_INVALID', `Invalid permissionMode: ${body.permissionMode}`),
        400
      );
    }
    if (body.maxSteps !== undefined) updateMaxSteps(body.maxSteps);
    if (body.maxStopContinuations !== undefined)
      updateMaxStopContinuations(body.maxStopContinuations);
    if (body.activeProfile !== undefined) updateActiveProfile(body.activeProfile);
    if (body.permissionMode !== undefined) updatePermissionMode(body.permissionMode);
    return c.json(readAgentConfig());
  });

  // ---- Context config ----
  router.post('/api/settings/context/compaction-model', async (c) => {
    const body = (await c.req.json()) as { compactionModel: string };
    updateContextCompactionModel(body.compactionModel);
    return c.json({ compactionModel: body.compactionModel });
  });
}
