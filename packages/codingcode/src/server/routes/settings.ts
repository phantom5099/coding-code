import { pipe } from 'effect';
import type { Router } from '../handler.js';
import { addMemorySettingsRoutes } from './memory.js';
import { addAgentSettingsRoutes } from './agent.js';
import { addHooksSettingsRoutes } from './hooks.js';
import { addMcpSettingsRoutes } from './mcp.js';
import { addSkillsSettingsRoutes } from './skills.js';

export const addSettingsRoutes = (router: Router): Router =>
  pipe(
    router,
    addMemorySettingsRoutes,
    addAgentSettingsRoutes,
    addHooksSettingsRoutes,
    addMcpSettingsRoutes,
    addSkillsSettingsRoutes
  );
