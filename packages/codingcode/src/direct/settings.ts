import { Effect } from 'effect';
import { McpService } from '../mcp/port.js';
import type { McpServerConfig, McpStatus } from '../contracts/mcp.js';
import { SkillService } from '../skills/port.js';
import type { PermissionMode } from '../contracts/permission.js';
import type { UserHookConfig } from '../contracts/hooks.js';
import { isGlobalCwd, resolveCwd } from '../core/path.js';
import {
  loadMcpConfig,
  writeMcpConfig,
  loadGlobalMcpConfig,
  writeGlobalMcpConfig,
  setGlobalMcpServerEnabled,
  setProjectMcpServerEnabled,
} from '../mcp/config.js';
import {
  loadHookConfigs,
  writeHookConfigs,
  loadGlobalHookConfigs,
  writeGlobalHookConfigs,
  resolveHookConfigs,
  setGlobalHookEnabled,
  setProjectHookEnabled,
} from '../hooks/config.js';
import { getMemoryConfig } from '../memory/config.js';
import { MemoryService } from '../memory/port.js';
import { AlreadyExistsError, NotFoundError } from '../contracts/error.js';
import {
  loadConfig,
  updateMemoryModel,
  updateContextCompactionModel,
} from '@codingcode/infra/config';
import type { AppRuntime } from '../layer.js';
import { SessionService } from '../session/port.js';
import type { SettingsClient } from '../client/contracts.js';

// ---- Helpers with validation ----

function mcpCreateServer(cwd: string, server: McpServerConfig): void {
  if (isGlobalCwd(cwd)) {
    const servers = loadGlobalMcpConfig();
    if (servers.some((s) => s.name === server.name)) {
      throw new AlreadyExistsError(`MCP server '${server.name}' already exists`);
    }
    writeGlobalMcpConfig([...servers, server]);
    return;
  }
  const servers = loadMcpConfig(cwd);
  if (servers.some((s) => s.name === server.name)) {
    throw new AlreadyExistsError(`MCP server '${server.name}' already exists`);
  }
  servers.push(server);
  writeMcpConfig(cwd, servers);
}

function mcpUpdateServer(cwd: string, name: string, server: McpServerConfig): void {
  if (isGlobalCwd(cwd)) {
    const servers = loadGlobalMcpConfig();
    const idx = servers.findIndex((s) => s.name === name);
    if (idx === -1) throw new NotFoundError(`MCP server '${name}' not found`);
    if (server.name !== name && servers.some((s) => s.name === server.name)) {
      throw new AlreadyExistsError(`MCP server '${server.name}' already exists`);
    }
    servers[idx] = server;
    writeGlobalMcpConfig(servers);
    return;
  }
  const servers = loadMcpConfig(cwd);
  const idx = servers.findIndex((s) => s.name === name);
  if (idx === -1) throw new NotFoundError(`MCP server '${name}' not found`);
  if (server.name !== name && servers.some((s) => s.name === server.name)) {
    throw new AlreadyExistsError(`MCP server '${server.name}' already exists`);
  }
  servers[idx] = server;
  writeMcpConfig(cwd, servers);
}

function mcpDeleteServer(cwd: string, name: string): void {
  if (isGlobalCwd(cwd)) {
    const servers = loadGlobalMcpConfig().filter((s) => s.name !== name);
    writeGlobalMcpConfig(servers);
    return;
  }
  const servers = loadMcpConfig(cwd);
  if (!servers.some((s) => s.name === name)) {
    throw new NotFoundError(`MCP server '${name}' not found in project config`);
  }
  writeMcpConfig(
    cwd,
    servers.filter((s) => s.name !== name)
  );
}

function hooksList(
  cwd: string
): Array<UserHookConfig & { source: 'global' | 'project'; hasProjectOverride?: boolean }> {
  if (isGlobalCwd(cwd)) {
    return loadGlobalHookConfigs().map((h) => ({
      ...h,
      enabled: h.enabled !== false,
      source: 'global' as const,
    }));
  }
  const globalHooks = loadGlobalHookConfigs();
  const projectHooks = loadHookConfigs(cwd);
  const globalNames = new Set(globalHooks.map((h) => h.name));
  const projectNames = new Set(projectHooks.map((h) => h.name));
  const merged = resolveHookConfigs(cwd);
  return merged.map((h) => {
    const isFromProject = projectNames.has(h.name);
    const isFromGlobal = globalNames.has(h.name);
    const hasProjectOverride = isFromProject && isFromGlobal;
    return {
      ...h,
      enabled: h.enabled !== false,
      source: (isFromProject ? 'project' : 'global') as 'global' | 'project',
      hasProjectOverride,
    };
  });
}

function hooksCreate(cwd: string, hook: UserHookConfig): void {
  if (isGlobalCwd(cwd)) {
    const hooks = loadGlobalHookConfigs();
    if (hooks.some((h) => h.name === hook.name)) {
      throw new AlreadyExistsError(`Hook '${hook.name}' already exists`);
    }
    writeGlobalHookConfigs([...hooks, hook]);
    return;
  }
  const hooks = loadHookConfigs(cwd);
  if (hooks.some((h) => h.name === hook.name)) {
    throw new AlreadyExistsError(`Hook '${hook.name}' already exists`);
  }
  hooks.push(hook);
  writeHookConfigs(cwd, hooks);
}

function hooksUpdate(cwd: string, name: string, hook: UserHookConfig): void {
  if (isGlobalCwd(cwd)) {
    const hooks = loadGlobalHookConfigs();
    const idx = hooks.findIndex((h) => h.name === name);
    if (idx === -1) throw new NotFoundError(`Hook '${name}' not found`);
    if (hook.name !== name && hooks.some((h) => h.name === hook.name)) {
      throw new AlreadyExistsError(`Hook '${hook.name}' already exists`);
    }
    hooks[idx] = hook;
    writeGlobalHookConfigs(hooks);
    return;
  }
  const hooks = loadHookConfigs(cwd);
  const idx = hooks.findIndex((h) => h.name === name);
  if (idx === -1) throw new NotFoundError(`Hook '${name}' not found`);
  if (hook.name !== name && hooks.some((h) => h.name === hook.name)) {
    throw new AlreadyExistsError(`Hook '${hook.name}' already exists`);
  }
  hooks[idx] = hook;
  writeHookConfigs(cwd, hooks);
}

function hooksDelete(cwd: string, name: string): void {
  if (isGlobalCwd(cwd)) {
    const hooks = loadGlobalHookConfigs().filter((h) => h.name !== name);
    writeGlobalHookConfigs(hooks);
    return;
  }
  const hooks = loadHookConfigs(cwd);
  if (!hooks.some((h) => h.name === name)) {
    throw new NotFoundError(`Hook '${name}' not found in project config`);
  }
  writeHookConfigs(
    cwd,
    hooks.filter((h) => h.name !== name)
  );
}

function hooksSetEnabled(cwd: string, name: string, enabled: boolean): void {
  if (isGlobalCwd(cwd)) {
    setGlobalHookEnabled(name, enabled);
    return;
  }
  setProjectHookEnabled(resolveCwd(cwd), name, enabled);
}

export function createDirectSettingsClient(rt: AppRuntime): SettingsClient {
  return {
    async getMemoryEnabled() {
      return rt.runPromise(
        Effect.gen(function* () {
          const m = yield* MemoryService;
          return m.getMemoryEnabled();
        })
      );
    },

    async getMemoryConfig() {
      const cfg = getMemoryConfig();
      return { enabled: cfg.enabled, model: cfg.model };
    },

    async setMemoryEnabled(enabled) {
      await rt.runPromise(
        Effect.gen(function* () {
          const m = yield* MemoryService;
          m.setMemoryEnabled(enabled);
        })
      );
    },

    async setMemoryModel(model) {
      updateMemoryModel(model);
      return { model };
    },

    async getAgentConfig() {
      const cfg = loadConfig();
      return { maxSteps: cfg.maxSteps, maxStopContinuations: cfg.maxStopContinuations };
    },

    async setCompactionModel(compactionModel) {
      updateContextCompactionModel(compactionModel);
      return { compactionModel };
    },

    async getMcpStatus({ cwd }) {
      const projectCwd = resolveCwd(cwd);
      const runtime = await rt.runPromise(
        Effect.gen(function* () {
          const mcp = yield* McpService;
          return yield* mcp.status(projectCwd);
        })
      );
      const runtimeByName = new Map(runtime.map((r) => [r.name, r]));
      if (isGlobalCwd(cwd)) {
        return loadGlobalMcpConfig().map((s) => ({
          ...runtimeByName.get(s.name),
          name: s.name,
          enabled: s.enabled !== false,
          source: 'global' as const,
        })) as McpStatus[];
      }
      const globalServers = loadGlobalMcpConfig();
      const projectServers = loadMcpConfig(projectCwd);
      const globalNames = new Set(globalServers.map((s) => s.name));
      const seen = new Set<string>();
      const result: Array<
        McpStatus & {
          enabled: boolean;
          source: 'global' | 'project';
          hasProjectOverride?: boolean;
        }
      > = [];
      for (const s of projectServers) {
        seen.add(s.name);
        const isFromGlobal = globalNames.has(s.name);
        const r = runtimeByName.get(s.name);
        result.push({
          ...(r ?? {
            name: s.name,
            transport: 'stdio' as const,
            toolCount: 0,
          }),
          name: s.name,
          enabled: s.enabled !== false,
          source: 'project',
          hasProjectOverride: isFromGlobal,
        });
      }
      for (const s of globalServers) {
        if (seen.has(s.name)) continue;
        const r = runtimeByName.get(s.name);
        result.push({
          ...(r ?? {
            name: s.name,
            transport: 'stdio' as const,
            toolCount: 0,
          }),
          name: s.name,
          enabled: s.enabled !== false,
          source: 'global',
        });
      }
      return result as McpStatus[];
    },

    async setMcpEnabled({ name, enabled, cwd }) {
      if (isGlobalCwd(cwd)) {
        setGlobalMcpServerEnabled(name, enabled);
      } else {
        setProjectMcpServerEnabled(resolveCwd(cwd), name, enabled);
      }
    },

    async createMcpServer({ cwd, server }) {
      mcpCreateServer(cwd, server);
    },

    async updateMcpServer({ cwd, name, server }) {
      mcpUpdateServer(cwd, name, server);
    },

    async deleteMcpServer({ cwd, name }) {
      mcpDeleteServer(cwd, name);
    },

    async listSkills({ cwd }) {
      return rt.runPromise(
        Effect.gen(function* () {
          const skill = yield* SkillService;
          return yield* skill.getAll(resolveCwd(cwd));
        })
      );
    },

    async listHooks({ cwd }) {
      return hooksList(cwd) as unknown as UserHookConfig[];
    },

    async createHook({ cwd, hook }) {
      hooksCreate(cwd, hook);
    },

    async updateHook({ cwd, name, hook }) {
      hooksUpdate(cwd, name, hook);
    },

    async deleteHook({ cwd, name }) {
      hooksDelete(cwd, name);
    },

    async setHookEnabled({ cwd, name, enabled }) {
      hooksSetEnabled(cwd, name, enabled);
    },

    async getGlobalPermissionMode(input: {
      sessionId: string;
      cwd: string;
    }): Promise<PermissionMode> {
      return rt.runPromise(
        Effect.gen(function* () {
          const session = yield* SessionService;
          const state = yield* session.load(input.cwd, input.sessionId);
          return state.permissionMode;
        })
      );
    },

    async setGlobalPermissionMode(input: {
      sessionId: string;
      cwd: string;
      mode: PermissionMode;
    }): Promise<void> {
      await rt.runPromise(
        Effect.gen(function* () {
          const session = yield* SessionService;
          yield* session.setPermissionMode(input.cwd, input.sessionId, input.mode);
        })
      );
    },
  };
}
