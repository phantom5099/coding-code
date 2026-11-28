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
import type { UserHookConfig } from './types.js';

const HOOKS_FILE: NamedListFile = { fileName: 'hooks', key: 'hooks' };

type RawHookConfig = Partial<UserHookConfig> & { name: string };

function targetFor(scope: ConfigScope): YamlNamedListTarget {
  const dir =
    scope.kind === 'global'
      ? getGlobalDir()
      : join(scope.projectPath, CODINGCODE_DIRNAME);
  return { dir, file: HOOKS_FILE };
}

export function loadHookConfigs(scope: ConfigScope): UserHookConfig[] {
  return readNamedList<RawHookConfig>(targetFor(scope)) as UserHookConfig[];
}

export function writeHookConfigs(scope: ConfigScope, hooks: readonly UserHookConfig[]): void {
  writeNamedList(targetFor(scope), hooks);
}

/** 合并 global 与 project 两层，得到运行时真正生效的 hook 列表 */
export function resolveHookConfigs(projectRoot: string): UserHookConfig[] {
  return mergeNamed(
    loadHookConfigs(GLOBAL_CONFIG_SCOPE),
    loadHookConfigs(projectConfigScope(projectRoot))
  );
}

export function setHookEnabledConfig(cmd: {
  readonly scope: ConfigScope;
  readonly name: string;
  readonly enabled: boolean;
}): void {
  patchNamed<RawHookConfig>(targetFor(cmd.scope), {
    name: cmd.name,
    patch: { enabled: cmd.enabled },
  });
}
