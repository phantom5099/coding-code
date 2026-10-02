import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export interface NamedListFile {
  readonly fileName: string;
  readonly key: string;
}

/** 丢掉值为 undefined 的键，避免下层未显式写的字段被擦掉 */
function definedOnly<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** 该目录下实际生效的文件；都不存在时给出默认写入位置（`.yaml` 优先） */
export function yamlStorePath(dir: string, file: NamedListFile): string {
  const candidates = [join(dir, `${file.fileName}.yaml`), join(dir, `${file.fileName}.yml`)];
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

/** 读顶层键下的列表；文件不存在或内容非法 → `[]` */
export function readNamedList<T>(dir: string, file: NamedListFile): T[] {
  const p = yamlStorePath(dir, file);
  if (!existsSync(p)) return [];
  try {
    const parsed = parseYaml(readFileSync(p, 'utf8')) as Record<string, T[]> | null;
    return parsed?.[file.key] ?? [];
  } catch {
    return [];
  }
}

/** 写回顶层键，目录/文件不存在则建，文件里其它顶层键原样保留 */
export function writeNamedList<T>(dir: string, file: NamedListFile, items: T[]): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = yamlStorePath(dir, file);
  let existing: Record<string, unknown> = {};
  if (existsSync(p)) {
    existing = (parseYaml(readFileSync(p, 'utf8')) as Record<string, unknown>) ?? {};
  }
  existing[file.key] = items;
  writeFileSync(p, stringifyYaml(existing), 'utf8');
}

/** 按 name 做字段级合并：后一层只覆盖它显式写出的字段，其余继承前一层 */
export function mergeNamed<T extends { name: string }>(base: T[], override: T[]): T[] {
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
  dir: string,
  file: NamedListFile,
  name: string,
  patch: Partial<T>
): void {
  const items = readNamedList<T>(dir, file);
  const idx = items.findIndex((item) => item?.name === name);
  // 追加分支：`T` 的类型收窄只有在拿到完整条目后才成立，故此处由调用方保证
  // patch 足以构成一条合法条目（与旧实现 `push({ name, enabled })` 同义）
  if (idx === -1) items.push({ name, ...patch } as T);
  else items[idx] = { ...items[idx]!, ...patch };
  writeNamedList(dir, file, items);
}
