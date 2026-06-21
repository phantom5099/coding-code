import { homedir } from 'os';
import { join } from 'path';

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

// ---- Project storage roots ----
//
// `~/.codingcode/project/<encodedProjectPath>/`     holds per-project session state
//                                              (jsonl + index + checkpoint git).
// `~/.codingcode/projects/<encodedProjectPath>/`    holds per-project plan files
//                                              (one markdown per sessionId).
//
// Both roots can be overridden by tests via the set* functions below, so that
// the production code never has to know about a specific disk layout and tests
// can redirect everything to a per-test tmpdir.

let _projectBaseOverride: string | undefined;
let _projectPlansBaseOverride: string | undefined;

export function setProjectBaseDir(dir: string | undefined): void {
  _projectBaseOverride = dir;
}

export function setProjectPlansBaseDir(dir: string | undefined): void {
  _projectPlansBaseOverride = dir;
}

export function getProjectBaseDir(): string {
  return _projectBaseOverride ?? join(homedir(), '.codingcode', 'project');
}

export function getProjectPlansBaseDir(): string {
  return _projectPlansBaseOverride ?? join(homedir(), '.codingcode', 'projects');
}
