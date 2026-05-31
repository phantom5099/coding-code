import { Effect } from 'effect';
import { McpService } from '../../mcp/index.js';
import type { McpServerConfig, McpStatus } from '../../mcp/types.js';
import { SkillService } from '../../skills/index.js';
import { getGlobalPermissionMode, setGlobalPermissionMode } from '../../approval/index.js';
import type { PermissionMode } from '../../approval/types.js';
import * as settingsService from '../../settings/service.js';
import type { SubagentProfile } from '../../subagent/registry.js';
import type { UserHookConfig } from '../../hooks/config.js';

export interface SettingsClient {
  getMemoryEnabled(): Promise<boolean>;
  getMemoryConfig(): Promise<{ enabled: boolean; types: Array<{ name: string; description: string; isBuiltIn: boolean; disabled: boolean }> }>;
  setMemoryEnabled(enabled: boolean): Promise<void>;
  setMemoryTypeDisabled(name: string, disabled: boolean): Promise<void>;
  addMemoryExtraType(type: { name: string; description: string }): Promise<void>;
  updateMemoryExtraType(name: string, type: { name: string; description: string }): Promise<void>;
  deleteMemoryExtraType(name: string): Promise<void>;
  getSubagentEnabled(): Promise<boolean>;
  setSubagentEnabled(enabled: boolean): Promise<void>;
  getMcpStatus(): Promise<McpStatus[]>;
  setMcpDisabled(name: string, disabled: boolean): Promise<void>;
  createMcpServer(input: { cwd: string; server: McpServerConfig }): Promise<void>;
  updateMcpServer(input: { cwd: string; name: string; server: McpServerConfig }): Promise<void>;
  deleteMcpServer(input: { cwd: string; name: string }): Promise<void>;
  listSkills(): Promise<Array<{ name: string; description: string; enabled: boolean }>>;
  toggleSkill(name: string, enabled: boolean): Promise<void>;
  listAgents(input: { cwd: string }): Promise<any[]>;
  createAgent(input: { cwd: string; profile: SubagentProfile }): Promise<void>;
  updateAgent(input: { cwd: string; name: string; profile: SubagentProfile }): Promise<void>;
  deleteAgent(input: { cwd: string; name: string }): Promise<void>;
  setAgentDisabled(name: string, disabled: boolean): Promise<void>;
  listHooks(input: { cwd: string }): Promise<UserHookConfig[]>;
  createHook(input: { cwd: string; hook: UserHookConfig }): Promise<void>;
  updateHook(input: { cwd: string; name: string; hook: UserHookConfig }): Promise<void>;
  deleteHook(input: { cwd: string; name: string }): Promise<void>;
  setHookDisabled(input: { cwd: string; name: string; disabled: boolean }): Promise<void>;
  getGlobalPermissionMode(): Promise<PermissionMode>;
  setGlobalPermissionMode(mode: PermissionMode): Promise<void>;
}

export function createDirectSettingsClient(
  runWithLayer: <T>(eff: any) => Promise<T>,
): SettingsClient {
  return {
    async getMemoryEnabled() {
      return settingsService.getMemoryEnabledService();
    },

    async getMemoryConfig() {
      return settingsService.getMemoryConfigWithTypes();
    },

    async setMemoryEnabled(enabled) {
      settingsService.setMemoryEnabledService(enabled);
    },

    async setMemoryTypeDisabled(name, disabled) {
      settingsService.setMemoryTypeDisabledService(name, disabled);
    },

    async addMemoryExtraType(type) {
      settingsService.addMemoryExtraTypeService(type);
    },

    async updateMemoryExtraType(name, type) {
      settingsService.updateMemoryExtraTypeService(name, type);
    },

    async deleteMemoryExtraType(name) {
      settingsService.deleteMemoryExtraTypeService(name);
    },

    async getSubagentEnabled() {
      return settingsService.getSubagentEnabled();
    },

    async setSubagentEnabled(enabled) {
      settingsService.setSubagentEnabled(enabled);
    },

    async getMcpStatus() {
      return runWithLayer(
        Effect.gen(function* () {
          const mcp = yield* McpService;
          return yield* mcp.status();
        }),
      );
    },

    async setMcpDisabled(name, disabled) {
      await runWithLayer(
        Effect.gen(function* () {
          const mcp = yield* McpService;
          return yield* (disabled ? mcp.disable(name) : mcp.enable(name));
        }),
      );
    },

    async createMcpServer({ cwd, server }) {
      settingsService.createMcpServer(cwd, server);
    },

    async updateMcpServer({ cwd, name, server }) {
      settingsService.updateMcpServer(cwd, name, server);
    },

    async deleteMcpServer({ cwd, name }) {
      settingsService.deleteMcpServer(cwd, name);
    },

    async listSkills() {
      return runWithLayer(
        Effect.gen(function* () {
          const skill = yield* SkillService;
          return yield* skill.listWithStatus();
        }),
      );
    },

    async toggleSkill(name, enabled) {
      await runWithLayer(
        Effect.gen(function* () {
          const skill = yield* SkillService;
          return yield* (enabled ? skill.enableSkill(name) : skill.disableSkill(name));
        }),
      );
    },

    async listAgents({ cwd }) {
      return settingsService.listAgents(cwd);
    },

    async createAgent({ cwd, profile }) {
      settingsService.createAgent(cwd, profile);
    },

    async updateAgent({ cwd, name, profile }) {
      settingsService.updateAgent(cwd, name, profile);
    },

    async deleteAgent({ cwd, name }) {
      settingsService.deleteAgent(cwd, name);
    },

    async setAgentDisabled(name, disabled) {
      settingsService.setAgentDisabled(name, disabled);
    },

    async listHooks({ cwd }) {
      return settingsService.listHooks(cwd);
    },

    async createHook({ cwd, hook }) {
      settingsService.createHook(cwd, hook);
    },

    async updateHook({ cwd, name, hook }) {
      settingsService.updateHook(cwd, name, hook);
    },

    async deleteHook({ cwd, name }) {
      settingsService.deleteHook(cwd, name);
    },

    async setHookDisabled({ cwd, name, disabled }) {
      settingsService.setHookDisabled(cwd, name, disabled);
    },

    async getGlobalPermissionMode() {
      return getGlobalPermissionMode();
    },

    async setGlobalPermissionMode(mode) {
      setGlobalPermissionMode(mode);
    },
  };
}
