import { join } from 'path';
import { normalizePath, encodeProjectPath, projectDataDir } from '../core/path.js';

/** 会话转录在项目数据目录下的布局。 */
export const SESSIONS_DIRNAME = 'sessions';

const SUBAGENTS_DIRNAME = 'subagents';
const TRANSCRIPT_SUFFIX = '.jsonl';

export interface SessionPaths {
  sessionId: string;
  cwd: string;
  projectPath: string;
  transcriptPath: string;
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
