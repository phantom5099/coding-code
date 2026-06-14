import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { McpServerConfig } from './types.js';
import { createDisabledStore } from '@codingcode/infra/disabled-store';

function resolveEnvVars(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] ?? '');
  }
  if (Array.isArray(value)) return value.map(resolveEnvVars);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, resolveEnvVars(v)])
    );
  }
  return value;
}

let _globalConfigDirOverride: string | undefined;

export function getGlobalConfigDir(): string {
  return _globalConfigDirOverride ?? join(homedir(), '.codingcode');
}

/** @internal Test-only hook to override the global config directory */
export function _setGlobalConfigDir(dir: string | undefined): void {
  _globalConfigDirOverride = dir;
}

function mergeByName<T extends { name: string }>(global: T[], project: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of global) map.set(item.name, item);
  for (const item of project) map.set(item.name, item);
  return Array.from(map.values());
}

export function loadMcpConfig(projectRoot: string): McpServerConfig[] {
  const paths = [
    join(projectRoot, '.codingcode', 'mcp.yaml'),
    join(projectRoot, '.codingcode', 'mcp.yml'),
  ];
  for (const p of paths) {
    if (existsSync(p)) {
      const raw = readFileSync(p, 'utf8');
      const parsed = parseYaml(raw) as { servers?: McpServerConfig[] };
      return (parsed.servers ?? []).map((s) => resolveEnvVars(s) as McpServerConfig);
    }
  }
  return [];
}

export function writeMcpConfig(projectRoot: string, servers: McpServerConfig[]): void {
  const dir = join(projectRoot, '.codingcode');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = join(dir, 'mcp.yaml');
  const existing: Record<string, unknown> = existsSync(p)
    ? (parseYaml(readFileSync(p, 'utf8')) as Record<string, unknown>)
    : {};
  existing.servers = servers;
  writeFileSync(p, stringifyYaml(existing), 'utf8');
}

export function loadGlobalMcpConfig(): McpServerConfig[] {
  const paths = [join(getGlobalConfigDir(), 'mcp.yaml'), join(getGlobalConfigDir(), 'mcp.yml')];
  for (const p of paths) {
    if (existsSync(p)) {
      const raw = readFileSync(p, 'utf8');
      const parsed = parseYaml(raw) as { servers?: McpServerConfig[] };
      return (parsed.servers ?? []).map((s) => resolveEnvVars(s) as McpServerConfig);
    }
  }
  return [];
}

export function writeGlobalMcpConfig(servers: McpServerConfig[]): void {
  const dir = getGlobalConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = join(dir, 'mcp.yaml');
  const existing: Record<string, unknown> = existsSync(p)
    ? (parseYaml(readFileSync(p, 'utf8')) as Record<string, unknown>)
    : {};
  existing.servers = servers;
  writeFileSync(p, stringifyYaml(existing), 'utf8');
}

export function resolveMcpConfig(projectRoot: string): McpServerConfig[] {
  const globalServers = loadGlobalMcpConfig();
  const projectServers = loadMcpConfig(projectRoot);
  return mergeByName(globalServers, projectServers);
}

// ---- MCP disabled state ----

const mcpDisabledStore = createDisabledStore({
  globalKeyPath: ['mcp', 'disabledServers'],
  getGlobalConfigDir,
});
export const getGlobalMcpDisabledState = mcpDisabledStore.getGlobal;
export const setGlobalMcpDisabledState = mcpDisabledStore.setGlobal;
export const getProjectMcpDisabledState = mcpDisabledStore.getProject;
export const setProjectMcpDisabledState = mcpDisabledStore.setProject;
export const resetProjectMcpDisabledState = mcpDisabledStore.resetProject;
export const resolveMcpDisabled = mcpDisabledStore.resolve;
