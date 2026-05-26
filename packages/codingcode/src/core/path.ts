/** Normalize a path to always produce the same encoded form for the same directory:
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

/** Encode a project path as a human-readable, filesystem-safe directory name.
 *  Colons, slashes, and spaces are collapsed into single dashes. */
export function encodeProjectPath(p: string): string {
  const normalized = normalizePath(p);
  return normalized
    .replace(/[:/\\ ]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}
