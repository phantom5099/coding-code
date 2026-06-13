import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { HookPoint, UserHookConfig } from './types.js';
import { createDisabledStore } from '@codingcode/infra/disabled-store';

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
  const paths = [join(getGlobalConfigDir(), 'hooks.yaml'), join(getGlobalConfigDir(), 'hooks.yml')];
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

// ---- Hook disabled state ----

const hookDisabledStore = createDisabledStore({ globalKeyPath: ['hooks', 'disabledHooks'], getGlobalConfigDir });
export const getGlobalHookDisabledState = hookDisabledStore.getGlobal;
export const setGlobalHookDisabledState = hookDisabledStore.setGlobal;
export const getProjectHookDisabledState = hookDisabledStore.getProject;
export const setProjectHookDisabledState = hookDisabledStore.setProject;
export const resetProjectHookDisabledState = hookDisabledStore.resetProject;
export const resolveHookDisabled = hookDisabledStore.resolve;
