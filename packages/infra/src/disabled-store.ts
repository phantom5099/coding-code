import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export interface DisabledStoreConfig {
  globalKeyPath: string[];
  /** Optional function that returns the global config directory. Defaults to ~/.codingcode */
  getGlobalConfigDir?: () => string;
}

export interface DisabledStore {
  getGlobal(name: string): boolean;
  setGlobal(name: string, disabled: boolean): void;
  getProject(projectRoot: string, name: string): boolean | undefined;
  setProject(projectRoot: string, name: string, disabled: boolean): void;
  resetProject(projectRoot: string, name: string): void;
  resolve(projectRoot: string, name: string): boolean;
}

function deepSet(obj: Record<string, unknown>, path: string[], name: string, value: unknown): void {
  let target: any = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    if (!target[key]) target[key] = {};
    target = target[key];
    if (!target) return;
  }
  const lastKey = path[path.length - 1]!;
  const map = (target[lastKey] as Record<string, unknown>) ?? {};
  map[name] = value;
  target[lastKey] = map;
}

function deepGet(obj: any, path: string[]): any {
  let value = obj;
  for (const k of path) {
    value = value?.[k];
  }
  return value;
}

function deepDelete(obj: any, path: string[], name: string): void {
  const value = deepGet(obj, path);
  if (value && typeof value === 'object') {
    delete (value as Record<string, unknown>)[name];
  }
}

export function createDisabledStore(cfg: DisabledStoreConfig): DisabledStore {
  const globalConfigPath = () =>
    join(cfg.getGlobalConfigDir?.() ?? join(homedir(), '.codingcode'), 'config.yaml');

  const getGlobal = (name: string): boolean => {
    const p = globalConfigPath();
    if (!existsSync(p)) return false;
    try {
      const config = parseYaml(readFileSync(p, 'utf8')) as any;
      const value = deepGet(config, cfg.globalKeyPath);
      return (value as Record<string, boolean>)?.[name] ?? false;
    } catch {
      return false;
    }
  };

  const setGlobal = (name: string, disabled: boolean): void => {
    const p = globalConfigPath();
    const dir = dirname(p);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const existing: Record<string, unknown> = existsSync(p)
      ? (parseYaml(readFileSync(p, 'utf8')) as Record<string, unknown>)
      : {};
    deepSet(existing, cfg.globalKeyPath, name, disabled);
    writeFileSync(p, stringifyYaml(existing), 'utf8');
  };

  const getProject = (projectRoot: string, name: string): boolean | undefined => {
    const p = join(projectRoot, '.codingcode', 'config.yaml');
    if (!existsSync(p)) return undefined;
    try {
      const config = parseYaml(readFileSync(p, 'utf8')) as Record<string, unknown>;
      const value = deepGet(config, cfg.globalKeyPath);
      return (value as Record<string, boolean>)?.[name];
    } catch {
      return undefined;
    }
  };

  const setProject = (projectRoot: string, name: string, disabled: boolean): void => {
    const dir = join(projectRoot, '.codingcode');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const p = join(dir, 'config.yaml');
    const existing: Record<string, unknown> = existsSync(p)
      ? (parseYaml(readFileSync(p, 'utf8')) as Record<string, unknown>)
      : {};
    deepSet(existing, cfg.globalKeyPath, name, disabled);
    writeFileSync(p, stringifyYaml(existing), 'utf8');
  };

  const resetProject = (projectRoot: string, name: string): void => {
    const p = join(projectRoot, '.codingcode', 'config.yaml');
    if (!existsSync(p)) return;
    const existing: Record<string, unknown> = parseYaml(readFileSync(p, 'utf8')) as Record<
      string,
      unknown
    >;
    deepDelete(existing, cfg.globalKeyPath, name);
    writeFileSync(p, stringifyYaml(existing), 'utf8');
  };

  const resolve = (projectRoot: string, name: string): boolean => {
    const pv = getProject(projectRoot, name);
    if (pv !== undefined) return pv;
    return getGlobal(name);
  };

  return { getGlobal, setGlobal, getProject, setProject, resetProject, resolve };
}
