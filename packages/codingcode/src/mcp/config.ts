import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { McpServerConfig } from '../contracts/mcp.js';

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

/** 丢掉值为 undefined 的键，避免下层未显式写的字段被擦掉 */
function definedOnly<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** 按 name 做字段级合并：项目层只覆盖它显式写出的字段，其余继承全局 */
function mergeConfigs<T extends { name: string }>(global: T[], project: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of global) map.set(item.name, { ...item });
  for (const item of project) {
    const base = map.get(item.name);
    map.set(item.name, base ? { ...base, ...definedOnly(item) } : { ...item });
  }
  return Array.from(map.values());
}

/** 该目录下实际生效的配置文件；都不存在时给出默认写入位置 */
function mcpConfigPath(dir: string): string {
  const candidates = [join(dir, 'mcp.yaml'), join(dir, 'mcp.yml')];
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

/** 读原始条目：不解析 ${VAR}，写路径必须用这个，否则会把解析后的值固化回文件 */
function readRawServers(dir: string): McpServerConfig[] {
  const p = mcpConfigPath(dir);
  if (!existsSync(p)) return [];
  try {
    const parsed = parseYaml(readFileSync(p, 'utf8')) as { servers?: McpServerConfig[] } | null;
    return parsed?.servers ?? [];
  } catch {
    return [];
  }
}

function writeServers(dir: string, servers: McpServerConfig[]): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = mcpConfigPath(dir);
  let existing: Record<string, unknown> = {};
  if (existsSync(p)) {
    existing = (parseYaml(readFileSync(p, 'utf8')) as Record<string, unknown>) ?? {};
  }
  existing.servers = servers;
  writeFileSync(p, stringifyYaml(existing), 'utf8');
}

export function loadMcpConfig(projectRoot: string): McpServerConfig[] {
  return readRawServers(join(projectRoot, '.codingcode')).map(
    (s) => resolveEnvVars(s) as McpServerConfig
  );
}

export function writeMcpConfig(projectRoot: string, servers: McpServerConfig[]): void {
  writeServers(join(projectRoot, '.codingcode'), servers);
}

export function loadGlobalMcpConfig(): McpServerConfig[] {
  return readRawServers(getGlobalConfigDir()).map((s) => resolveEnvVars(s) as McpServerConfig);
}

export function writeGlobalMcpConfig(servers: McpServerConfig[]): void {
  writeServers(getGlobalConfigDir(), servers);
}

export function resolveMcpConfig(projectRoot: string): McpServerConfig[] {
  return mergeConfigs(loadGlobalMcpConfig(), loadMcpConfig(projectRoot));
}

// ---- MCP 开关 ----
// 开关就是定义里的一个布尔字段 `enabled`，没有独立的开关状态存储。
// 改开关 = 改写某一层 mcp.yaml 里该 server 的 `enabled`。

/**
 * 就地改写某一层配置文件里某个 server 的 `enabled`。
 * 该层还没有这个 server 时补一条最小覆盖 `{ name, enabled }`——
 * 字段级合并下这就足以关掉/打开上层定义的 server，而不必复制它的其它字段。
 */
function patchServerEnabled(dir: string, name: string, enabled: boolean): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = mcpConfigPath(dir);
  let existing: Record<string, unknown> = {};
  if (existsSync(p)) {
    existing = (parseYaml(readFileSync(p, 'utf8')) as Record<string, unknown>) ?? {};
  }
  const servers = (existing.servers as Array<Record<string, unknown>> | undefined) ?? [];
  const idx = servers.findIndex((s) => s?.name === name);
  if (idx === -1) servers.push({ name, enabled });
  else servers[idx] = { ...servers[idx], enabled };
  existing.servers = servers;
  writeFileSync(p, stringifyYaml(existing), 'utf8');
}

export function setGlobalMcpServerEnabled(name: string, enabled: boolean): void {
  patchServerEnabled(getGlobalConfigDir(), name, enabled);
}

export function setProjectMcpServerEnabled(
  projectRoot: string,
  name: string,
  enabled: boolean
): void {
  patchServerEnabled(join(projectRoot, '.codingcode'), name, enabled);
}
