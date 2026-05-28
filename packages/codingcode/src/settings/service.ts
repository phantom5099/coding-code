import { loadMcpConfig, writeMcpConfig } from '../mcp/config.js';
import type { McpServerConfig } from '../mcp/types.js';
import { loadAgentProfiles, writeAgentProfile, updateAgentProfile, deleteAgentProfile } from '../subagent/loader.js';
import type { SubagentProfile } from '../subagent/registry.js';
import { EXPLORE_PROFILE, isAgentDisabledState, setAgentDisabledState } from '../subagent/registry.js';
import { loadHookConfigs, writeHookConfigs } from '../hooks/config.js';
import { setHookRuntimeEnabled } from '../hooks/executor.js';
import type { UserHookConfig } from '../hooks/config.js';

// ---- MCP ----

export function listMcpServers(cwd: string): McpServerConfig[] {
  return loadMcpConfig(cwd);
}

export function createMcpServer(cwd: string, server: McpServerConfig): void {
  const servers = loadMcpConfig(cwd);
  if (servers.some(s => s.name === server.name)) {
    throw new AlreadyExistsError(`MCP server '${server.name}' already exists`);
  }
  servers.push(server);
  writeMcpConfig(cwd, servers);
}

export function updateMcpServer(cwd: string, name: string, server: McpServerConfig): void {
  const servers = loadMcpConfig(cwd);
  const idx = servers.findIndex(s => s.name === name);
  if (idx === -1) {
    throw new NotFoundError(`MCP server '${name}' not found`);
  }
  if (server.name !== name && servers.some(s => s.name === server.name)) {
    throw new AlreadyExistsError(`MCP server '${server.name}' already exists`);
  }
  servers[idx] = server;
  writeMcpConfig(cwd, servers);
}

export function deleteMcpServer(cwd: string, name: string): void {
  const servers = loadMcpConfig(cwd).filter(s => s.name !== name);
  writeMcpConfig(cwd, servers);
}

// ---- Agents ----

export function listAgents(cwd: string): Array<{
  name: string; description: string; tools?: string[]; mcpServers?: string[];
  readonly?: boolean; maxSteps?: number; model?: string; disabled: boolean;
}> {
  const custom = loadAgentProfiles(cwd);
  return [EXPLORE_PROFILE, ...custom].map(a => ({
    name: a.name, description: a.description, tools: a.tools,
    mcpServers: a.mcpServers, readonly: a.readonly, maxSteps: a.maxSteps,
    model: a.model, disabled: isAgentDisabledState(a.name),
  }));
}

export function createAgent(cwd: string, profile: SubagentProfile): void {
  const existing = loadAgentProfiles(cwd);
  if (existing.some(a => a.name === profile.name)) {
    throw new AlreadyExistsError(`Agent '${profile.name}' already exists`);
  }
  writeAgentProfile(cwd, profile);
}

export function updateAgent(cwd: string, name: string, profile: SubagentProfile): void {
  const existing = loadAgentProfiles(cwd);
  if (!existing.some(a => a.name === name)) {
    throw new NotFoundError(`Agent '${name}' not found`);
  }
  if (profile.name !== name && existing.some(a => a.name === profile.name)) {
    throw new AlreadyExistsError(`Agent '${profile.name}' already exists`);
  }
  updateAgentProfile(cwd, name, profile);
}

export function deleteAgent(cwd: string, name: string): void {
  deleteAgentProfile(cwd, name);
}

export function setAgentDisabled(name: string, disabled: boolean): void {
  setAgentDisabledState(name, disabled);
}

// ---- Hooks ----

export function listHooks(cwd: string): UserHookConfig[] {
  return loadHookConfigs(cwd);
}

export function createHook(cwd: string, hook: UserHookConfig): void {
  const hooks = loadHookConfigs(cwd);
  if (hooks.some(h => h.name === hook.name)) {
    throw new AlreadyExistsError(`Hook '${hook.name}' already exists`);
  }
  hooks.push(hook);
  writeHookConfigs(cwd, hooks);
}

export function updateHook(cwd: string, name: string, hook: UserHookConfig): void {
  const hooks = loadHookConfigs(cwd);
  const idx = hooks.findIndex(h => h.name === name);
  if (idx === -1) {
    throw new NotFoundError(`Hook '${name}' not found`);
  }
  if (hook.name !== name && hooks.some(h => h.name === hook.name)) {
    throw new AlreadyExistsError(`Hook '${hook.name}' already exists`);
  }
  hooks[idx] = hook;
  writeHookConfigs(cwd, hooks);
}

export function deleteHook(cwd: string, name: string): void {
  const hooks = loadHookConfigs(cwd).filter(h => h.name !== name);
  writeHookConfigs(cwd, hooks);
}

export function setHookDisabled(cwd: string, name: string, disabled: boolean): void {
  setHookRuntimeEnabled(name, !disabled);
  const hooks = loadHookConfigs(cwd);
  const hook = hooks.find(h => h.name === name);
  if (hook) {
    hook.enabled = !disabled;
    writeHookConfigs(cwd, hooks);
  }
}

// ---- Error types ----

export class AlreadyExistsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlreadyExistsError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}
