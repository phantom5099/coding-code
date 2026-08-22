import { Effect } from 'effect';
import { McpService } from '../mcp/index.js';
import type { McpServerConfig, McpStatus } from '../mcp/types.js';
import { SkillService } from '../skills/service.js';
import type { PermissionMode } from '../approval/types.js';
import type { UserHookConfig } from '../hooks/types.js';
import { isGlobalCwd } from '../core/workspace.js';
import {
  loadMcpConfig,
  writeMcpConfig,
  loadGlobalMcpConfig,
  writeGlobalMcpConfig,
  getGlobalMcpDisabledState,
  setGlobalMcpDisabledState,
  setProjectMcpDisabledState,
  resetProjectMcpDisabledState,
} from '../mcp/config.js';
import {
  loadHookConfigs,
  writeHookConfigs,
  loadGlobalHookConfigs,
  writeGlobalHookConfigs,
  resolveHookConfigs,
  setGlobalHookDisabledState,
  setProjectHookDisabledState,
  resetProjectHookDisabledState,
} from '../hooks/config.js';
import { setHookRuntimeEnabled } from '../hooks/executor.js';
import {
  getMemoryConfig,
  getAllTypesWithStatus,
  setMemoryTypeDisabled,
  addMemoryExtraType as _addMemoryExtraType,
  updateMemoryExtraType as _updateMemoryExtraType,
  deleteMemoryExtraType as _deleteMemoryExtraType,
} from '../memory/config.js';
import { MemoryService } from '../memory/index.js';
import { AlreadyExistsError, NotFoundError } from '../core/error.js';
import {
  loadConfig,
  updateMemoryModel,
  updateContextCompactionModel,
} from '@codingcode/infra/config';
import type { AppRuntime } from '../layer.js';
import { SessionService } from '../session/store.js';

export interface SettingsClient {
  getMemoryEnabled(): Promise<boolean>;
  getMemoryConfig(): Promise<{
    enabled: boolean;
    types: Array<{ name: string; description: string; isBuiltIn: boolean; disabled: boolean }>;
    model: string;
  }>;
  setMemoryEnabled(enabled: boolean): Promise<void>;
  setMemoryTypeDisabled(name: string, disabled: boolean): Promise<void>;
  addMemoryExtraType(type: { name: string; description: string }): Promise<void>;
  updateMemoryExtraType(name: string, type: { name: string; description: string }): Promise<void>;
  deleteMemoryExtraType(name: string): Promise<void>;
  setMemoryModel(model: string): Promise<{ model: string }>;
  getAgentConfig(): Promise<{ maxSteps: number; maxStopContinuations: number }>;
  setCompactionModel(compactionModel: string): Promise<{ compactionModel: string }>;
  getMcpStatus(input: { cwd: string }): Promise<McpStatus[]>;
  setMcpDisabled(body: { name: string; disabled: boolean; cwd: string }): Promise<void>;
  resetMcpDisabled(body: { name: string; cwd: string }): Promise<void>;
  createMcpServer(input: { cwd: string; server: McpServerConfig }): Promise<void>;
  updateMcpServer(input: { cwd: string; name: string; server: McpServerConfig }): Promise<void>;
  deleteMcpServer(input: { cwd: string; name: string }): Promise<void>;
  listSkills(): Promise<Array<{ name: string; description: string; enabled: boolean }>>;
  toggleSkill(body: { name: string; enabled: boolean; cwd: string }): Promise<void>;
  listHooks(input: { cwd: string }): Promise<UserHookConfig[]>;
  createHook(input: { cwd: string; hook: UserHookConfig }): Promise<void>;
  updateHook(input: { cwd: string; name: string; hook: UserHookConfig }): Promise<void>;
  deleteHook(input: { cwd: string; name: string }): Promise<void>;
  setHookDisabled(input: { cwd: string; name: string; disabled: boolean }): Promise<void>;
  resetHookDisabled(body: { name: string; cwd: string }): Promise<void>;
  getGlobalPermissionMode(input: { sessionId: string; cwd: string }): Promise<PermissionMode>;
  setGlobalPermissionMode(input: {
    sessionId: string;
    cwd: string;
    mode: PermissionMode;
  }): Promise<void>;
}

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
    return loadGlobalHookConfigs().map((h) => ({ ...h, source: 'global' as const }));
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

function hooksSetDisabled(cwd: string, name: string, disabled: boolean): void {
  setHookRuntimeEnabled(name, !disabled);
  const hooks = loadHookConfigs(cwd);
  const hook = hooks.find((h) => h.name === name);
  if (hook) {
    hook.enabled = !disabled;
    writeHookConfigs(cwd, hooks);
  }
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
      return { enabled: cfg.enabled, types: getAllTypesWithStatus(cfg), model: cfg.model };
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

    async setMemoryTypeDisabled(name, disabled) {
      setMemoryTypeDisabled(name, disabled);
    },

    async addMemoryExtraType(type) {
      _addMemoryExtraType({ name: type.name, description: type.description, enabled: true });
    },

    async updateMemoryExtraType(name, type) {
      _updateMemoryExtraType(name, {
        name: type.name,
        description: type.description,
        enabled: true,
      });
    },

    async deleteMemoryExtraType(name) {
      _deleteMemoryExtraType(name);
    },

    async getMcpStatus({ cwd }) {
      const projectCwd = isGlobalCwd(cwd) ? process.cwd() : cwd;
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
          disabled: getGlobalMcpDisabledState(s.name),
          source: 'global' as const,
        })) as McpStatus[];
      }
      const globalServers = loadGlobalMcpConfig();
      const projectServers = loadMcpConfig(projectCwd);
      const globalNames = new Set(globalServers.map((s) => s.name));
      const seen = new Set<string>();
      const result: Array<
        McpStatus & { source: 'global' | 'project'; hasProjectOverride?: boolean }
      > = [];
      for (const s of projectServers) {
        seen.add(s.name);
        const isFromGlobal = globalNames.has(s.name);
        const r = runtimeByName.get(s.name);
        result.push({
          ...(r ?? {
            name: s.name,
            connected: false,
            transport: 'stdio' as const,
            reconnectAttempts: 0,
            leaseCount: 0,
            toolCount: 0,
          }),
          name: s.name,
          disabled: r?.disabled ?? false,
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
            connected: false,
            transport: 'stdio' as const,
            reconnectAttempts: 0,
            leaseCount: 0,
            toolCount: 0,
          }),
          name: s.name,
          disabled: r?.disabled ?? false,
          source: 'global',
        });
      }
      return result as McpStatus[];
    },

    async setMcpDisabled({ name, disabled, cwd }) {
      if (isGlobalCwd(cwd)) {
        setGlobalMcpDisabledState(name, disabled);
      } else {
        setProjectMcpDisabledState(cwd, name, disabled);
      }
      await rt.runPromise(
        Effect.gen(function* () {
          const mcp = yield* McpService;
          return yield* disabled
            ? mcp.disable(isGlobalCwd(cwd) ? process.cwd() : cwd, name)
            : mcp.enable(isGlobalCwd(cwd) ? process.cwd() : cwd, name);
        })
      );
    },

    async resetMcpDisabled({ name, cwd }) {
      resetProjectMcpDisabledState(cwd, name);
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

    async listSkills() {
      return rt.runPromise(
        Effect.gen(function* () {
          const skill = yield* SkillService;
          return yield* skill.listWithStatus(process.cwd());
        })
      );
    },

    async toggleSkill({ name, enabled, cwd }) {
      const skillCwd = cwd || process.cwd();
      await rt.runPromise(
        Effect.gen(function* () {
          const skill = yield* SkillService;
          if (enabled) {
            yield* skill.enableSkill(skillCwd, name);
          } else {
            yield* skill.disableSkill(skillCwd, name);
          }
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

    async setHookDisabled({ cwd, name, disabled }) {
      if (isGlobalCwd(cwd)) {
        setGlobalHookDisabledState(name, disabled);
      } else {
        setProjectHookDisabledState(cwd, name, disabled);
      }
      hooksSetDisabled(cwd, name, disabled);
    },

    async resetHookDisabled({ name, cwd }) {
      resetProjectHookDisabledState(cwd, name);
    },

    async getGlobalPermissionMode(input: {
      sessionId: string;
      cwd: string;
    }): Promise<PermissionMode> {
      return rt.runPromise(
        Effect.gen(function* () {
          const session = yield* SessionService;
          const state = yield* session.load(input.cwd, input.sessionId);
          return yield* session.getPermissionMode(state);
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
          const state = yield* session.load(input.cwd, input.sessionId);
          yield* session.setPermissionMode(state, input.mode);
        })
      );
    },
  };
}
