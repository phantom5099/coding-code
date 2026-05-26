import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { McpServerConfig } from './types';

function resolveEnvVars(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] ?? '');
  }
  if (Array.isArray(value)) return value.map(resolveEnvVars);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, resolveEnvVars(v)]),
    );
  }
  return value;
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
