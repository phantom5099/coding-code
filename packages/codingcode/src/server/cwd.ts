import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { AgentError } from '../core/error.js';
import { getGlobalDir } from '../core/path.js';

export function isGlobalCwd(raw: string | undefined): boolean {
  return !raw || raw === '' || raw === 'global';
}

export function tempCwd(): string {
  return join(getGlobalDir(), 'temp');
}

export function resolveCwd(raw?: string): string {
  return raw ? resolve(raw) : tempCwd();
}

export function resolveWorkspaceCwd(raw?: string): string {
  if (isGlobalCwd(raw)) return tempCwd();
  const abs = resolve(raw!);
  if (!existsSync(abs)) {
    throw new AgentError('CONFIG_INVALID', `Workspace directory does not exist: ${abs}`);
  }
  return abs;
}
