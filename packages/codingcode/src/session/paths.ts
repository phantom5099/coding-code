import { join } from 'path';
import { normalizePath, encodeProjectPath, projectDataDir } from '../util/path.js';
import { AgentError } from '../util/error.js';

/** 会话转录在项目数据目录下的布局。 */
export const SESSIONS_DIRNAME = 'sessions';

/** 项目数据目录下存放输入附件（图片 / 音频 / PDF）的目录名。 */
export const ASSETS_DIRNAME = 'assets';

/** 子智能体转录统一挂在顶层会话的此目录下。 */
export const SUBAGENTS_DIRNAME = 'subagents';
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

/**
 * 子智能体转录的归属会话：祖先链末位，即顶层主会话。
 *
 * 全部子智能体——不论派发深度——都挂在同一个顶层会话的 subagents/ 下，
 * 由链末位一次定位，无需逐层建目录。链未提供（历史孙代会话）时回落直接父会话
 *
 * @param parentChain 本会话的祖先链，由近及远；元素 0 即直接父会话
 */
export function subagentOwnerOf(
  parentSessionId?: string,
  parentChain?: readonly string[]
): string | undefined {
  if (!parentSessionId) return undefined;
  return parentChain && parentChain.length > 0
    ? parentChain[parentChain.length - 1]
    : parentSessionId;
}

/**
 * 定位会话转录文件。
 *
 * @param parentSessionId 直接父会话 id；缺省表示顶层会话
 * @param parentChain 本会话的祖先链，由近及远，见 {@link subagentOwnerOf}
 */
export function transcriptPathOf(
  cwd: string,
  sessionId: string,
  parentSessionId?: string,
  parentChain?: readonly string[]
): string {
  const sessionsDir = projectSessionsDir(cwd);
  const owner = subagentOwnerOf(parentSessionId, parentChain);
  return owner
    ? join(sessionsDir, owner, SUBAGENTS_DIRNAME, `${sessionId}${TRANSCRIPT_SUFFIX}`)
    : join(sessionsDir, `${sessionId}${TRANSCRIPT_SUFFIX}`);
}

export function computePaths(
  cwd: string,
  sessionId: string,
  parentSessionId?: string,
  parentChain?: readonly string[]
): SessionPaths {
  const normalizedCwd = normalizePath(cwd);
  return {
    sessionId,
    cwd: normalizedCwd,
    projectPath: encodeProjectPath(normalizedCwd),
    transcriptPath: transcriptPathOf(normalizedCwd, sessionId, parentSessionId, parentChain),
  };
}
