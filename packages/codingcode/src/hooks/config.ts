import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
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

function getGlobalConfigDir(): string {
  return join(homedir(), '.codingcode');
}

function mergeByName<T extends { name: string }>(global: T[], project: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of global) map.set(item.name, item);
  for (const item of project) map.set(item.name, item);
  return Array.from(map.values());
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

export function loadGlobalHookConfigs(): UserHookConfig[] {
  const paths = [
    join(getGlobalConfigDir(), 'hooks.yaml'),
    join(getGlobalConfigDir(), 'hooks.yml'),
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

export function writeGlobalHookConfigs(hooks: UserHookConfig[]): void {
  const dir = getGlobalConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = join(dir, 'hooks.yaml');
  const existing: Record<string, unknown> = existsSync(p)
    ? (parseYaml(readFileSync(p, 'utf8')) as Record<string, unknown>)
    : {};
  existing.hooks = hooks;
  writeFileSync(p, stringifyYaml(existing), 'utf8');
}

export function resolveHookConfigs(projectRoot: string): UserHookConfig[] {
  const globalHooks = loadGlobalHookConfigs();
  const projectHooks = loadHookConfigs(projectRoot);
  return mergeByName(globalHooks, projectHooks);
}

// ---- 全局级 Hook disabled 状态：持久化到 ~/.codingcode/config.yaml ----

export function getGlobalHookDisabledState(hookName: string): boolean {
  try {
    const p = join(getGlobalConfigDir(), 'config.yaml');
    if (!existsSync(p)) return false;
    const raw = readFileSync(p, 'utf8');
    const config = parseYaml(raw) as any;
    const disabled = config.hooks?.disabledHooks as Record<string, boolean>;
    return disabled?.[hookName] ?? false;
  } catch {
    return false;
  }
}

export function setGlobalHookDisabledState(hookName: string, disabled: boolean): void {
  const dir = getGlobalConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = join(dir, 'config.yaml');
  const existing: Record<string, unknown> = existsSync(p)
    ? (parseYaml(readFileSync(p, 'utf8')) as Record<string, unknown>)
    : {};
  const hooks = (existing.hooks as Record<string, unknown>) ?? {};
  const disabledHooks = (hooks.disabledHooks as Record<string, boolean>) ?? {};
  disabledHooks[hookName] = disabled;
  hooks.disabledHooks = disabledHooks;
  existing.hooks = hooks;
  writeFileSync(p, stringifyYaml(existing), 'utf8');
}

// ---- 项目级 Hook disabled 状态：持久化到 .codingcode/config.yaml ----

export function getProjectHookDisabledState(projectRoot: string, hookName: string): boolean | undefined {
  const p = join(projectRoot, '.codingcode', 'config.yaml');
  if (!existsSync(p)) return undefined;
  try {
    const raw = readFileSync(p, 'utf8');
    const config = parseYaml(raw) as any;
    const disabled = config.hooks?.disabledHooks as Record<string, boolean>;
    return disabled?.[hookName];
  } catch {
    return undefined;
  }
}

export function setProjectHookDisabledState(projectRoot: string, hookName: string, disabled: boolean): void {
  const dir = join(projectRoot, '.codingcode');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = join(dir, 'config.yaml');
  const existing: Record<string, unknown> = existsSync(p)
    ? (parseYaml(readFileSync(p, 'utf8')) as Record<string, unknown>)
    : {};
  const hooks = (existing.hooks as Record<string, unknown>) ?? {};
  const disabledHooks = (hooks.disabledHooks as Record<string, boolean>) ?? {};
  disabledHooks[hookName] = disabled;
  hooks.disabledHooks = disabledHooks;
  existing.hooks = hooks;
  writeFileSync(p, stringifyYaml(existing), 'utf8');
}

export function resetProjectHookDisabledState(projectRoot: string, hookName: string): void {
  const p = join(projectRoot, '.codingcode', 'config.yaml');
  if (!existsSync(p)) return;
  const existing: Record<string, unknown> = parseYaml(readFileSync(p, 'utf8')) as Record<string, unknown>;
  const hooks = (existing.hooks as Record<string, unknown>) ?? {};
  const disabledHooks = hooks.disabledHooks as Record<string, boolean>;
  if (disabledHooks) {
    delete disabledHooks[hookName];
    hooks.disabledHooks = disabledHooks;
  }
  existing.hooks = hooks;
  writeFileSync(p, stringifyYaml(existing), 'utf8');
}

// 解析最终生效的 Hook disabled 状态：项目级 > 全局级
export function resolveHookDisabled(projectRoot: string, hookName: string): boolean {
  const projectVal = getProjectHookDisabledState(projectRoot, hookName);
  if (projectVal !== undefined) return projectVal;
  return getGlobalHookDisabledState(hookName);
}
