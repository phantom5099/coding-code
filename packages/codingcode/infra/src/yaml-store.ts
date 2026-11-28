import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ConfigSource } from '@codingcode/util';

export interface NamedListFile {
  readonly fileName: string;
  readonly key: string;
}

export interface YamlNamedListTarget {
  readonly dir: string;
  readonly file: NamedListFile;
}

/** 命名配置集合的变更结果（MCP / Hook 等共享） */
export type ConfigMutationOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'not-found' | 'already-exists' };

/** 带来源与启用态归一的配置列表项 */
export type ScopedConfigEntry<T> = T & {
  enabled: boolean;
  source: ConfigSource;
  /** 仅项目层返回；全局层不带该键 */
  hasProjectOverride?: boolean;
};

/** 丢掉值为 undefined 的键，避免下层未显式写的字段被擦掉 */
function definedOnly<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** 该目录下实际生效的文件；都不存在时给出默认写入位置（`.yaml` 优先） */
export function yamlStorePath(target: YamlNamedListTarget): string {
  const candidates = [
    join(target.dir, `${target.file.fileName}.yaml`),
    join(target.dir, `${target.file.fileName}.yml`),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

/** 读顶层键下的列表；文件不存在或内容非法 → `[]` */
export function readNamedList<T>(target: YamlNamedListTarget): T[] {
  const p = yamlStorePath(target);
  if (!existsSync(p)) return [];
  try {
    const parsed = parseYaml(readFileSync(p, 'utf8')) as Record<string, T[]> | null;
    return parsed?.[target.file.key] ?? [];
  } catch {
    return [];
  }
}

/** 写回顶层键，目录/文件不存在则建，文件里其它顶层键原样保留 */
export function writeNamedList<T>(target: YamlNamedListTarget, items: readonly T[]): void {
  if (!existsSync(target.dir)) mkdirSync(target.dir, { recursive: true });
  const p = yamlStorePath(target);
  let existing: Record<string, unknown> = {};
  if (existsSync(p)) {
    const parsed = parseYaml(readFileSync(p, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  }
  existing[target.file.key] = items;
  writeFileSync(p, stringifyYaml(existing), 'utf8');
}

/** 按 name 做字段级合并：后一层只覆盖它显式写出的字段，其余继承前一层 */
export function mergeNamed<T extends { name: string }>(base: readonly T[], override: readonly T[]): T[] {
  const map = new Map<string, T>();
  for (const item of base) map.set(item.name, { ...item });
  for (const item of override) {
    const prev = map.get(item.name);
    map.set(item.name, prev ? { ...prev, ...definedOnly(item) } : { ...item });
  }
  return Array.from(map.values());
}

/** 只改一条的若干字段；该 name 不存在时按 `{ name, ...patch }` 追加 */
export function patchNamed<T extends { name: string }>(
  target: YamlNamedListTarget,
  cmd: { readonly name: string; readonly patch: Partial<T> }
): void {
  const items = readNamedList<T>(target);
  const idx = items.findIndex((item) => item?.name === cmd.name);
  if (idx === -1) items.push({ name: cmd.name, ...cmd.patch } as T);
  else items[idx] = { ...items[idx]!, ...cmd.patch };
  writeNamedList(target, items);
}
