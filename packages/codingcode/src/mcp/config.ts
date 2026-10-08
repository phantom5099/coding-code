import { join } from 'path';
import {
  mergeNamed,
  patchNamed,
  readNamedList,
  writeNamedList,
  type NamedListFile,
} from '../infra/yaml-store.js';
import { getGlobalDir, CODINGCODE_DIRNAME } from '../util/path.js';
import type { McpServerConfig } from './types.js';

/** mcp 的落盘形状：`<dir>/.codingcode/mcp.yaml` 的 `servers:` */
const MCP_FILE: NamedListFile = { fileName: 'mcp', key: 'servers' };

/** 项目层的覆盖项可能只写了 name/enabled，故条目类型按部分字段读 */
type RawMcpServerConfig = Partial<McpServerConfig> & { name: string };

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

export function loadMcpConfig(projectRoot: string): McpServerConfig[] {
  return readNamedList<RawMcpServerConfig>(join(projectRoot, CODINGCODE_DIRNAME), MCP_FILE).map(
    (s) => resolveEnvVars(s) as McpServerConfig
  );
}

export function writeMcpConfig(projectRoot: string, servers: McpServerConfig[]): void {
  writeNamedList(join(projectRoot, CODINGCODE_DIRNAME), MCP_FILE, servers);
}

export function loadGlobalMcpConfig(): McpServerConfig[] {
  return readNamedList<RawMcpServerConfig>(getGlobalDir(), MCP_FILE).map(
    (s) => resolveEnvVars(s) as McpServerConfig
  );
}

export function writeGlobalMcpConfig(servers: McpServerConfig[]): void {
  writeNamedList(getGlobalDir(), MCP_FILE, servers);
}

export function resolveMcpConfig(projectRoot: string): McpServerConfig[] {
  return mergeNamed(loadGlobalMcpConfig(), loadMcpConfig(projectRoot));
}

export function setGlobalMcpServerEnabled(name: string, enabled: boolean): void {
  patchNamed<RawMcpServerConfig>(getGlobalDir(), MCP_FILE, name, { enabled });
}

export function setProjectMcpServerEnabled(
  projectRoot: string,
  name: string,
  enabled: boolean
): void {
  patchNamed<RawMcpServerConfig>(join(projectRoot, CODINGCODE_DIRNAME), MCP_FILE, name, {
    enabled,
  });
}
