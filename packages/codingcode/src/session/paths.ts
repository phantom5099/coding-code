import { join } from 'path';
import { normalizePath, encodeProjectPath, projectDataDir } from '../util/path.js';
import { AgentError } from '../util/error.js';

/** 会话转录在项目数据目录下的布局。 */
export const SESSIONS_DIRNAME = 'sessions';

/** 项目数据目录下存放输入附件（图片 / 音频 / PDF）的目录名。 */
export const ASSETS_DIRNAME = 'assets';

const SUBAGENTS_DIRNAME = 'subagents';
const TRANSCRIPT_SUFFIX = '.jsonl';

const ASSET_RE = /^[0-9a-f]{32}\.(png|jpg|webp|gif|wav|mp3|pdf)$/;

export interface SessionPaths {
  sessionId: string;
  cwd: string;
  projectPath: string;
  transcriptPath: string;
}

export function projectSessionsDir(cwd: string): string {
  return join(projectDataDir(cwd), SESSIONS_DIRNAME);
}

/** 项目级资产目录：本项目的全部会话共享，与 sessions/ 并列。 */
export function assetsDirOf(cwd: string): string {
  return join(projectDataDir(cwd), ASSETS_DIRNAME);
}

/** 资产名会直接成为文件名，只接受内容寻址形状。 */
export function assertAssetName(name: string): void {
  if (!ASSET_RE.test(name)) {
    throw new AgentError('INVALID_INPUT', `Invalid asset name: ${name}`);
  }
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
