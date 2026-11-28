import { join } from 'path';
import {
  mergeNamed,
  patchNamed,
  readNamedList,
  writeNamedList,
  type NamedListFile,
  type YamlNamedListTarget,
} from '@codingcode/infra';
import {
  CODINGCODE_DIRNAME,
  GLOBAL_CONFIG_SCOPE,
  getGlobalDir,
  projectConfigScope,
  type ConfigScope,
} from '@codingcode/util';
import type { McpServerConfig } from './types.js';

/** mcp 的落盘形状：`<dir>/.codingcode/mcp.yaml` 的 `servers:` */
const MCP_FILE: NamedListFile = { fileName: 'mcp', key: 'servers' };

/** 项目层的覆盖项可能只写了 name/enabled，故条目类型按部分字段读 */
type RawMcpServerConfig = Partial<McpServerConfig> & { name: string };

function targetFor(scope: ConfigScope): YamlNamedListTarget {
  const dir =
    scope.kind === 'global'
      ? getGlobalDir()
      : join(scope.projectPath, CODINGCODE_DIRNAME);
  return { dir, file: MCP_FILE };
}

function resolveEnvVars<T>(value: T): T {
  if (typeof value === 'string') {
    return value.replace(/\$\{(\w+)\}/g, (_, key: string) => process.env[key] ?? '') as T;
  }
  if (Array.isArray(value)) return value.map((item) => resolveEnvVars(item)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, resolveEnvVars(v)])
    ) as T;
  }
  return value;
}

export function loadMcpConfig(scope: ConfigScope): McpServerConfig[] {
  return readNamedList<RawMcpServerConfig>(targetFor(scope)).map(
    (s) => resolveEnvVars(s) as McpServerConfig
  );
}

export function writeMcpConfig(scope: ConfigScope, servers: readonly McpServerConfig[]): void {
  writeNamedList(targetFor(scope), servers);
}

export function resolveMcpConfig(projectRoot: string): McpServerConfig[] {
  return mergeNamed(
    loadMcpConfig(GLOBAL_CONFIG_SCOPE),
    loadMcpConfig(projectConfigScope(projectRoot))
  );
}

export function setMcpServerEnabledConfig(cmd: {
  readonly scope: ConfigScope;
  readonly name: string;
  readonly enabled: boolean;
}): void {
  patchNamed<RawMcpServerConfig>(targetFor(cmd.scope), {
    name: cmd.name,
    patch: { enabled: cmd.enabled },
  });
}
