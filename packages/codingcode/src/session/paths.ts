import { join } from 'path';
import { getGlobalDir, normalizePath, encodeProjectPath } from '../core/path.js';
import {
  PROJECTS_DIRNAME,
  SESSIONS_DIRNAME,
  SUBAGENTS_DIRNAME,
  TRANSCRIPT_SUFFIX,
} from '../contracts/paths.js';


export interface SessionPaths {
  sessionId: string;
  cwd: string;
  projectPath: string;
  transcriptPath: string;
}

export function projectDataDir(cwd: string): string {
  return join(getGlobalDir(), PROJECTS_DIRNAME, encodeProjectPath(normalizePath(cwd)));
}

export function projectSessionsDir(cwd: string): string {
  return join(projectDataDir(cwd), SESSIONS_DIRNAME);
}

export function transcriptPathOf(cwd: string, sessionId: string, parentSessionId?: string): string {
  const sessionsDir = projectSessionsDir(cwd);
  return parentSessionId
    ? join(sessionsDir, parentSessionId, SUBAGENTS_DIRNAME, `${sessionId}${TRANSCRIPT_SUFFIX}`)
    : join(sessionsDir, `${sessionId}${TRANSCRIPT_SUFFIX}`);
}

export function computePaths(
  cwd: string,
  sessionId: string,
  parentSessionId?: string
): SessionPaths {
  const normalizedCwd = normalizePath(cwd);
  return {
    sessionId,
    cwd: normalizedCwd,
    projectPath: encodeProjectPath(normalizedCwd),
    transcriptPath: transcriptPathOf(normalizedCwd, sessionId, parentSessionId),
  };
}
