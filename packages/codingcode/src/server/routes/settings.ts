import type { Hono } from 'hono';
import type { ManagedRuntime } from 'effect';
import { registerMemorySettingsRoutes } from './memory.js';
import { registerAgentSettingsRoutes } from './agent.js';
import { registerHooksSettingsRoutes } from './hooks.js';
import { registerMcpSettingsRoutes } from './mcp.js';
import { registerSkillsSettingsRoutes } from './skills.js';

type ManagedRt = ManagedRuntime.ManagedRuntime<any, any>;

export function registerSettingsRoutes(router: Hono, rt: ManagedRt): void {
  registerMemorySettingsRoutes(router, rt);
  registerAgentSettingsRoutes(router);
  registerHooksSettingsRoutes(router);
  registerMcpSettingsRoutes(router);
  registerSkillsSettingsRoutes(router, rt);
}
