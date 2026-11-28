import { homedir } from 'os';
import { join } from 'path';

export const CODINGCODE_DIRNAME = '.codingcode';

/** 工作区数据的公共根所在目录名。 */
const PROJECTS_DIRNAME = 'project';

export function getGlobalDir(): string {
  return join(homedir(), CODINGCODE_DIRNAME);
}

/** 工作区数据的公共根：`<global>/project`。 */
export function projectRootDir(): string {
  return join(getGlobalDir(), PROJECTS_DIRNAME);
}

/** 某工作区在数据根下的私有目录。 */
export function projectDataDir(cwd: string): string {
  return join(projectRootDir(), encodeProjectPath(normalizePath(cwd)));
}

export function normalizePath(p: string): string {
  let s = p.replaceAll('\\', '/');
  s = s.replace(/^\/([a-zA-Z])\//, (_, letter: string) => `${letter.toLowerCase()}:/`);
  s = s.replace(/^([A-Z]):/, (_, letter: string) => letter.toLowerCase() + ':');
  return s;
}

export function encodeProjectPath(p: string): string {
  const normalized = normalizePath(p);
  return normalized
    .replace(/[:/\\ ]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}
