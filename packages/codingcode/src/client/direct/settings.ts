import { Effect } from 'effect';
import { McpService } from '../../mcp/index.js';
import type { McpServerConfig, McpStatus } from '../../mcp/types.js';
import { SkillService } from '../../skills/index.js';
import { getGlobalPermissionMode, setGlobalPermissionMode } from '../../approval/index.js';
import type { PermissionMode } from '../../approval/types.js';
import type { AgentProfile } from '../../subagent/registry.js';
import type { UserHookConfig } from '../../hooks/config.js';
import {
  loadMcpConfig,
  writeMcpConfig,
  resolveMcpDisabled,
  setGlobalMcpDisabledState,
  setProjectMcpDisabledState,
  resetProjectMcpDisabledState,
} from '../../mcp/config.js';
import {
  loadAgentProfiles,
  writeAgentProfile,
  updateAgentProfile,
  deleteAgentProfile,
} from '../../subagent/loader.js';
import {
  EXPLORE_PROFILE,
  setSubagentEnabledState,
  resolveSubagentEnabled,
  getProjectSubagentEnabledState,
  setProjectSubagentEnabledState,
  resetProjectSubagentEnabledState,
  setGlobalAgentDisabledState,
  setProjectAgentDisabledState,
  resetProjectAgentDisabledState,
  resolveAgentDisabled,
  getProjectAgentDisabledState,
} from '../../subagent/registry.js';
import {
  loadHookConfigs,
  writeHookConfigs,
  resolveHookDisabled,
  setGlobalHookDisabledState,
  setProjectHookDisabledState,
  resetProjectHookDisabledState,
} from '../../hooks/config.js';
import { setHookRuntimeEnabled } from '../../hooks/executor.js';
import {
  getMemoryConfig,
  getAllTypesWithStatus,
  setMemoryTypeDisabled,
  addMemoryExtraType as _addMemoryExtraType,
  updateMemoryExtraType as _updateMemoryExtraType,
  deleteMemoryExtraType as _deleteMemoryExtraType,
} from '../../memory/config.js';
import { getMemoryEnabled, setMemoryEnabled } from '../../memory/index.js';
import { AlreadyExistsError, NotFoundError } from '../../core/error.js';

export interface SettingsClient {
  getMemoryEnabled(): Promise<boolean>;
  getMemoryConfig(): Promise<{
    enabled: boolean;
    types: Array<{ name: string; description: string; isBuiltIn: boolean; disabled: boolean }>;
  }>;
  setMemoryEnabled(enabled: boolean): Promise<void>;
  setMemoryTypeDisabled(name: string, disabled: boolean): Promise<void>;
  addMemoryExtraType(type: { name: string; description: string }): Promise<void>;
  updateMemoryExtraType(name: string, type: { name: string; description: string }): Promise<void>;
  deleteMemoryExtraType(name: string): Promise<void>;
  getSubagentEnabled(query: { cwd: string }): Promise<{ enabled: boolean; source: string }>;
  setSubagentEnabled(body: { enabled: boolean; cwd: string }): Promise<void>;
  resetSubagentEnabled(body: { cwd: string }): Promise<void>;
  getMcpStatus(): Promise<McpStatus[]>;
  setMcpDisabled(body: { name: string; disabled: boolean; cwd: string }): Promise<void>;
  resetMcpDisabled(body: { name: string; cwd: string }): Promise<void>;
  createMcpServer(input: { cwd: string; server: McpServerConfig }): Promise<void>;
  updateMcpServer(input: { cwd: string; name: string; server: McpServerConfig }): Promise<void>;
  deleteMcpServer(input: { cwd: string; name: string }): Promise<void>;
  listSkills(): Promise<Array<{ name: string; description: string; enabled: boolean }>>;
  toggleSkill(body: { name: string; enabled: boolean; cwd: string }): Promise<void>;
  listAgents(input: { cwd: string }): Promise<any[]>;
  createAgent(input: { cwd: string; profile: AgentProfile }): Promise<void>;
  updateAgent(input: { cwd: string; name: string; profile: AgentProfile }): Promise<void>;
  deleteAgent(input: { cwd: string; name: string }): Promise<void>;
  setAgentDisabled(body: { name: string; disabled: boolean; cwd: string }): Promise<void>;
  resetAgentDisabled(body: { name: string; cwd: string }): Promise<void>;
  listHooks(input: { cwd: string }): Promise<UserHookConfig[]>;
  createHook(input: { cwd: string; hook: UserHookConfig }): Promise<void>;
  updateHook(input: { cwd: string; name: string; hook: UserHookConfig }): Promise<void>;
  deleteHook(input: { cwd: string; name: string }): Promise<void>;
  setHookDisabled(input: { cwd: string; name: string; disabled: boolean }): Promise<void>;
  resetHookDisabled(body: { name: string; cwd: string }): Promise<void>;
  getGlobalPermissionMode(): Promise<PermissionMode>;
  setGlobalPermissionMode(mode: PermissionMode): Promise<void>;
}

// ---- Helpers with validation ----

function mcpCreateServer(cwd: string, server: McpServerConfig): void {
  const servers = loadMcpConfig(cwd);
  if (servers.some((s) => s.name === server.name)) {
    throw new AlreadyExistsError(`MCP server '${server.name}' already exists`);
  }
  servers.push(server);
  writeMcpConfig(cwd, servers);
}

function mcpUpdateServer(cwd: string, name: string, server: McpServerConfig): void {
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
  const servers = loadMcpConfig(cwd).filter((s) => s.name !== name);
  writeMcpConfig(cwd, servers);
}

function agentsList(cwd: string): Array<{
  name: string;
  description: string;
  tools?: string[];
  mcpServers?: string[];
  readonly?: boolean;
  maxSteps?: number;
  model?: string;
  disabled: boolean;
  source: 'builtin' | 'global' | 'project';
  hasProjectOverride?: boolean;
  projectDisabled?: boolean;
}> {
  const custom = loadAgentProfiles(cwd);
  return [EXPLORE_PROFILE, ...custom].map((a) => {
    const projectVal = getProjectAgentDisabledState(cwd, a.name);
    return {
      name: a.name,
      description: a.description,
      tools: a.tools,
      mcpServers: a.mcpServers,
      readonly: a.readonly,
      maxSteps: a.maxSteps,
      model: a.model,
      disabled: resolveAgentDisabled(cwd, a.name),
      source: a.name === EXPLORE_PROFILE.name ? ('builtin' as const) : ('project' as const),
      hasProjectOverride: projectVal !== undefined,
      projectDisabled: projectVal,
    };
  });
}

function agentsCreate(cwd: string, profile: AgentProfile): void {
  const existing = loadAgentProfiles(cwd);
  if (existing.some((a) => a.name === profile.name)) {
    throw new AlreadyExistsError(`Agent '${profile.name}' already exists`);
  }
  writeAgentProfile(cwd, profile);
}

function agentsUpdate(cwd: string, name: string, profile: AgentProfile): void {
  const existing = loadAgentProfiles(cwd);
  if (!existing.some((a) => a.name === name)) throw new NotFoundError(`Agent '${name}' not found`);
  if (profile.name !== name && existing.some((a) => a.name === profile.name)) {
    throw new AlreadyExistsError(`Agent '${profile.name}' already exists`);
  }
  updateAgentProfile(cwd, name, profile);
}

function hooksCreate(cwd: string, hook: UserHookConfig): void {
  const hooks = loadHookConfigs(cwd);
  if (hooks.some((h) => h.name === hook.name)) {
    throw new AlreadyExistsError(`Hook '${hook.name}' already exists`);
  }
  hooks.push(hook);
  writeHookConfigs(cwd, hooks);
}

function hooksUpdate(cwd: string, name: string, hook: UserHookConfig): void {
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
  const hooks = loadHookConfigs(cwd).filter((h) => h.name !== name);
  writeHookConfigs(cwd, hooks);
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

export function createDirectSettingsClient(
  runWithLayer: <T>(eff: any) => Promise<T>
): SettingsClient {
  return {
    async getMemoryEnabled() {
      return getMemoryEnabled();
    },

    async getMemoryConfig() {
      const cfg = getMemoryConfig();
      return { enabled: cfg.enabled, types: getAllTypesWithStatus(cfg) };
    },

    async setMemoryEnabled(enabled) {
      setMemoryEnabled(enabled);
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

    async getSubagentEnabled({ cwd }) {
      const projectVal = getProjectSubagentEnabledState(cwd);
      return {
        enabled: resolveSubagentEnabled(cwd),
        source: projectVal !== undefined ? 'project' : 'global',
      };
    },

    async setSubagentEnabled({ enabled, cwd }) {
      if (!cwd || cwd === '' || cwd === 'global') {
        setSubagentEnabledState(enabled);
      } else {
        setProjectSubagentEnabledState(cwd, enabled);
      }
    },

    async resetSubagentEnabled({ cwd }) {
      resetProjectSubagentEnabledState(cwd);
    },

    async getMcpStatus() {
      return runWithLayer(
        Effect.gen(function* () {
          const mcp = yield* McpService;
          return yield* mcp.status(process.cwd());
        })
      );
    },

    async setMcpDisabled({ name, disabled, cwd }) {
      if (!cwd || cwd === '' || cwd === 'global') {
        setGlobalMcpDisabledState(name, disabled);
      } else {
        setProjectMcpDisabledState(cwd, name, disabled);
      }
      await runWithLayer(
        Effect.gen(function* () {
          const mcp = yield* McpService;
          return yield* disabled
            ? mcp.disable(cwd || process.cwd(), name)
            : mcp.enable(cwd || process.cwd(), name);
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
      return runWithLayer(
        Effect.gen(function* () {
          const skill = yield* SkillService;
          return yield* skill.listWithStatus(process.cwd());
        })
      );
    },

    async toggleSkill({ name, enabled, cwd }) {
      await runWithLayer(
        Effect.gen(function* () {
          const skill = yield* SkillService;
          const skillCwd = cwd || process.cwd();
          return yield* enabled
            ? skill.enableSkill(skillCwd, name)
            : skill.disableSkill(skillCwd, name);
        })
      );
    },

    async listAgents({ cwd }) {
      return agentsList(cwd);
    },

    async createAgent({ cwd, profile }) {
      agentsCreate(cwd, profile);
    },

    async updateAgent({ cwd, name, profile }) {
      agentsUpdate(cwd, name, profile);
    },

    async deleteAgent({ cwd, name }) {
      deleteAgentProfile(cwd, name);
    },

    async setAgentDisabled({ name, disabled, cwd }) {
      if (!cwd || cwd === '' || cwd === 'global') {
        setGlobalAgentDisabledState(name, disabled);
      } else {
        setProjectAgentDisabledState(cwd, name, disabled);
      }
    },

    async resetAgentDisabled({ name, cwd }) {
      resetProjectAgentDisabledState(cwd, name);
    },

    async listHooks({ cwd }) {
      return loadHookConfigs(cwd);
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
      if (!cwd || cwd === '' || cwd === 'global') {
        setGlobalHookDisabledState(name, disabled);
      } else {
        setProjectHookDisabledState(cwd, name, disabled);
      }
      hooksSetDisabled(cwd, name, disabled);
    },

    async resetHookDisabled({ name, cwd }) {
      resetProjectHookDisabledState(cwd, name);
    },

    async getGlobalPermissionMode() {
      return getGlobalPermissionMode();
    },

    async setGlobalPermissionMode(mode) {
      setGlobalPermissionMode(mode);
    },
  };
}
