import { existsSync } from 'fs';
import { join, resolve } from 'path';
import {
  AgentError,
  GLOBAL_CONFIG_SCOPE,
  getGlobalDir,
  projectConfigScope,
  type ConfigScope,
} from '@codingcode/util';
import type { SessionKey } from '@codingcode/session';

export const NEW_SESSION_SENTINEL = '_';

export function isGlobalCwd(raw: string | undefined): boolean {
  return !raw || raw === '' || raw === 'global';
}

export function tempCwd(): string {
  return join(getGlobalDir(), 'temp');
}

export function resolveCwd(raw?: string): string {
  return raw ? resolve(raw) : tempCwd();
}

export function resolveConfigScope(raw?: string): ConfigScope {
  return isGlobalCwd(raw) ? GLOBAL_CONFIG_SCOPE : projectConfigScope(resolveCwd(raw));
}

export function sessionKeyOf(id: string | undefined, rawCwd?: string): SessionKey {
  return { cwd: resolveCwd(rawCwd), sessionId: id ?? '' };
}

export function resolveWorkspaceCwd(raw?: string): string {
  if (isGlobalCwd(raw)) return tempCwd();
  const abs = resolve(raw!);
  if (!existsSync(abs)) {
    throw new AgentError('CONFIG_INVALID', `Workspace directory does not exist: ${abs}`);
  }
  return abs;
}
