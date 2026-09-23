import { homedir } from 'os';
import { join } from 'path';

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

let _projectBaseOverride: string | undefined;

export function setProjectBaseDir(dir: string | undefined): void {
  _projectBaseOverride = dir;
}

export function getProjectBaseDir(): string {
  return _projectBaseOverride ?? join(homedir(), '.codingcode', 'project');
}

export interface SessionPaths {
  sessionId: string;
  cwd: string;
  projectPath: string;
  transcriptPath: string;
  indexPath: string;
}

export function projectSessionsDir(encodedProjectPath: string): string {
  return join(getProjectBaseDir(), encodedProjectPath, 'sessions');
}

export function computePaths(
  cwd: string,
  sessionId: string,
  parentSessionId?: string
): SessionPaths {
  const normalizedCwd = normalizePath(cwd);
  const projectPath = encodeProjectPath(normalizedCwd);
  const sessionsDir = projectSessionsDir(projectPath);
  const transcriptPath = parentSessionId
    ? join(sessionsDir, parentSessionId, 'subagents', `${sessionId}.jsonl`)
    : join(sessionsDir, `${sessionId}.jsonl`);
  const indexPath = transcriptPath.replace('.jsonl', '.index.json');
  return { sessionId, cwd: normalizedCwd, projectPath, transcriptPath, indexPath };
}
