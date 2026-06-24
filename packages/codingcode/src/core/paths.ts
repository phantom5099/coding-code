import { join } from 'path';
import { getProjectBaseDir, encodeProjectPath, normalizePath } from './path.js';

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

export function sessionJsonlPathFromCwd(cwd: string, sessionId: string): string {
  return computePaths(cwd, sessionId).transcriptPath;
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
