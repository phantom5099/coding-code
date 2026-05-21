import { createHash } from 'crypto';

/** Normalize a path to always produce the same slug for the same directory:
 *  - Convert POSIX /c/... → c:/... (Git Bash paths on Windows)
 *  - Convert backslashes to forward slashes
 *  - Lowercase drive letter
 *  Does NOT call path.resolve() since it mishandles /c/... on Windows. */
export function normalizePath(p: string): string {
  let s = p.replaceAll('\\', '/');
  s = s.replace(/^\/([a-zA-Z])\//, (_, letter: string) => `${letter.toLowerCase()}:/`);
  s = s.replace(/^([A-Z]):/, (_, letter: string) => letter.toLowerCase() + ':');
  return s;
}

export function projectSlugFromPath(p: string): string {
  const normalized = normalizePath(p);
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}
