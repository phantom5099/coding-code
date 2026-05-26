import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { HookPoint } from './registry.js';

export interface UserHookConfig {
  name: string;
  description?: string;
  point: HookPoint;
  type: 'observer' | 'decision';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  priority?: number;
  enabled: boolean;
}

export function loadHookConfigs(projectRoot: string): UserHookConfig[] {
  const paths = [
    join(projectRoot, '.codingcode', 'hooks.yaml'),
    join(projectRoot, '.codingcode', 'hooks.yml'),
  ];
  for (const p of paths) {
    if (existsSync(p)) {
      const raw = readFileSync(p, 'utf8');
      const parsed = parseYaml(raw) as { hooks?: UserHookConfig[] };
      return parsed.hooks ?? [];
    }
  }
  return [];
}

export function writeHookConfigs(projectRoot: string, hooks: UserHookConfig[]): void {
  const dir = join(projectRoot, '.codingcode');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = join(dir, 'hooks.yaml');
  const existing: Record<string, unknown> = existsSync(p)
    ? (parseYaml(readFileSync(p, 'utf8')) as Record<string, unknown>)
    : {};
  existing.hooks = hooks;
  writeFileSync(p, stringifyYaml(existing), 'utf8');
}
