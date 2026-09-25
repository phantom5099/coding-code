import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { UserHookConfig } from '../contracts/hooks.js';

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
function hookConfigPath(dir: string): string {
  const candidates = [join(dir, 'hooks.yaml'), join(dir, 'hooks.yml')];
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

/** 项目层的覆盖项可能只写了 name/enabled，故条目类型按部分字段读 */
type RawHookConfig = Partial<UserHookConfig> & { name: string };

function readRawHooks(dir: string): RawHookConfig[] {
  const p = hookConfigPath(dir);
  if (!existsSync(p)) return [];
  try {
    const parsed = parseYaml(readFileSync(p, 'utf8')) as { hooks?: RawHookConfig[] } | null;
    return parsed?.hooks ?? [];
  } catch {
    return [];
  }
}

function writeHooks(dir: string, hooks: RawHookConfig[]): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = hookConfigPath(dir);
  let existing: Record<string, unknown> = {};
  if (existsSync(p)) {
    existing = (parseYaml(readFileSync(p, 'utf8')) as Record<string, unknown>) ?? {};
  }
  existing.hooks = hooks;
  writeFileSync(p, stringifyYaml(existing), 'utf8');
}

export function loadHookConfigs(projectRoot: string): UserHookConfig[] {
  return readRawHooks(join(projectRoot, '.codingcode')) as UserHookConfig[];
}

export function writeHookConfigs(projectRoot: string, hooks: UserHookConfig[]): void {
  writeHooks(join(projectRoot, '.codingcode'), hooks);
}

export function loadGlobalHookConfigs(): UserHookConfig[] {
  return readRawHooks(getGlobalConfigDir()) as UserHookConfig[];
}

export function writeGlobalHookConfigs(hooks: UserHookConfig[]): void {
  writeHooks(getGlobalConfigDir(), hooks);
}

/** 合并 global 与 project 两层，得到运行时真正生效的 hook 列表 */
export function resolveHookConfigs(projectRoot: string): UserHookConfig[] {
  return mergeConfigs(loadGlobalHookConfigs(), loadHookConfigs(projectRoot)) as UserHookConfig[];
}

// ---- Hook 开关 ----
// 开关就是定义里的一个布尔字段 `enabled`，没有独立的开关状态存储。
// 改开关 = 改写某一层 hooks.yaml 里该 hook 的 `enabled`。

/**
 * 就地改写某一层配置文件里某个 hook 的 `enabled`。
 * 该层还没有这个 hook 时补一条最小覆盖 `{ name, enabled }`——
 * 字段级合并下这就足以关掉/打开上层定义的 hook，而不必复制 address/command 等字段。
 */
function patchHookEnabled(dir: string, name: string, enabled: boolean): void {
  const hooks = readRawHooks(dir);
  const idx = hooks.findIndex((h) => h?.name === name);
  if (idx === -1) hooks.push({ name, enabled });
  else hooks[idx] = { ...hooks[idx]!, enabled };
  writeHooks(dir, hooks);
}

export function setGlobalHookEnabled(name: string, enabled: boolean): void {
  patchHookEnabled(getGlobalConfigDir(), name, enabled);
}

export function setProjectHookEnabled(projectRoot: string, name: string, enabled: boolean): void {
  patchHookEnabled(join(projectRoot, '.codingcode'), name, enabled);
}
