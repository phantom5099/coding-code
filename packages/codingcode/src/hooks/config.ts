import {
  mergeNamed,
  patchNamed,
  readNamedList,
  writeNamedList,
  type NamedListFile,
} from '../infra/yaml-store.js';
import { getGlobalDir, getProjectDir } from '../core/path.js';
import type { UserHookConfig } from '../contracts/hooks.js';

const HOOKS_FILE: NamedListFile = { fileName: 'hooks', key: 'hooks' };

type RawHookConfig = Partial<UserHookConfig> & { name: string };

export function loadHookConfigs(projectRoot: string): UserHookConfig[] {
  return readNamedList<RawHookConfig>(getProjectDir(projectRoot), HOOKS_FILE) as UserHookConfig[];
}

export function writeHookConfigs(projectRoot: string, hooks: UserHookConfig[]): void {
  writeNamedList(getProjectDir(projectRoot), HOOKS_FILE, hooks);
}

export function loadGlobalHookConfigs(): UserHookConfig[] {
  return readNamedList<RawHookConfig>(getGlobalDir(), HOOKS_FILE) as UserHookConfig[];
}

export function writeGlobalHookConfigs(hooks: UserHookConfig[]): void {
  writeNamedList(getGlobalDir(), HOOKS_FILE, hooks);
}

/** 合并 global 与 project 两层，得到运行时真正生效的 hook 列表 */
export function resolveHookConfigs(projectRoot: string): UserHookConfig[] {
  return mergeNamed(loadGlobalHookConfigs(), loadHookConfigs(projectRoot));
}

export function setGlobalHookEnabled(name: string, enabled: boolean): void {
  patchNamed<RawHookConfig>(getGlobalDir(), HOOKS_FILE, name, { enabled });
}

export function setProjectHookEnabled(projectRoot: string, name: string, enabled: boolean): void {
  patchNamed<RawHookConfig>(getProjectDir(projectRoot), HOOKS_FILE, name, { enabled });
}
