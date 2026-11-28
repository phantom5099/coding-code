import { join } from 'path';
import { AgentError, encodeProjectPath, normalizePath, projectDataDir } from '@codingcode/util';
import type {
  SessionKey,
  SessionLineage,
  SessionLocator,
  SessionRef,
  SessionStoreState,
} from './types.js';

export const SESSIONS_DIRNAME = 'sessions';
export const ASSETS_DIRNAME = 'assets';
export const SUBAGENTS_DIRNAME = 'subagents';
const TRANSCRIPT_SUFFIX = '.jsonl';

const ASSET_RE = /^[0-9a-f]{32}\.(png|jpg|webp|gif|wav|mp3|pdf)$/;

export interface SessionPaths extends SessionKey {
  readonly projectPath: string;
  readonly transcriptPath: string;
}

export function projectSessionsDir(cwd: string): string {
  return join(projectDataDir(cwd), SESSIONS_DIRNAME);
}

export function assetsDirOf(cwd: string): string {
  return join(projectDataDir(cwd), ASSETS_DIRNAME);
}

export function assertAssetName(name: string): void {
  if (!ASSET_RE.test(name)) {
    throw new AgentError('INVALID_INPUT', `Invalid asset name: ${name}`);
  }
}

/** 子智能体转录归属会话：祖先链末位（顶层主会话），链缺省时回落直接父会话 */
export function subagentOwnerOf(lineage: SessionLineage): string | undefined {
  if (!lineage.parentSessionId) return undefined;
  return lineage.parentChain && lineage.parentChain.length > 0
    ? lineage.parentChain[lineage.parentChain.length - 1]
    : lineage.parentSessionId;
}

/** 从父会话定位器派生子会话谱系 */
export function childLineageOf(parent: SessionLocator): SessionLineage {
  return {
    parentSessionId: parent.sessionId,
    parentChain: [parent.sessionId, ...(parent.parentChain ?? [])],
  };
}

/** 从父会话定位器与子会话 id 构造子会话定位器 */
export function deriveChildLocator(parent: SessionLocator, childSessionId: string): SessionLocator {
  return {
    cwd: parent.cwd,
    sessionId: childSessionId,
    ...childLineageOf(parent),
  };
}

/** 从当前会话出发寻址相关会话（祖先链上的会话或直接子会话） */
export function resolveRelatedLocator(self: SessionLocator, targetSessionId: string): SessionLocator {
  const chain = self.parentChain ?? [];
  const ancestorIdx = chain.indexOf(targetSessionId);
  if (ancestorIdx !== -1) {
    const ancestorChain = chain.slice(ancestorIdx + 1);
    return ancestorChain.length > 0
      ? {
          cwd: self.cwd,
          sessionId: targetSessionId,
          parentSessionId: ancestorChain[0],
          parentChain: ancestorChain,
        }
      : { cwd: self.cwd, sessionId: targetSessionId };
  }
  return deriveChildLocator(self, targetSessionId);
}

/** 定位会话转录文件 */
export function transcriptPathOf(locator: SessionLocator): string {
  const sessionsDir = projectSessionsDir(locator.cwd);
  const owner = subagentOwnerOf(locator);
  return owner
    ? join(sessionsDir, owner, SUBAGENTS_DIRNAME, `${locator.sessionId}${TRANSCRIPT_SUFFIX}`)
    : join(sessionsDir, `${locator.sessionId}${TRANSCRIPT_SUFFIX}`);
}

export function computePaths(locator: SessionLocator): SessionPaths {
  const normalizedCwd = normalizePath(locator.cwd);
  return {
    sessionId: locator.sessionId,
    cwd: normalizedCwd,
    projectPath: encodeProjectPath(normalizedCwd),
    transcriptPath: transcriptPathOf({ ...locator, cwd: normalizedCwd }),
  };
}

/** 从聚合运行态派生回合级引用，保证祖先链不丢失 */
export function sessionRefOf(state: SessionStoreState): SessionRef {
  return {
    cwd: state.cwd,
    sessionId: state.sessionId,
    parentSessionId: state.parentSessionId,
    parentChain: state.parentChain,
    currentTurnId: state.currentTurnId,
  };
}

/** 从回合引用或运行态投影为纯定位值对象（剔除 currentTurnId） */
export function sessionLocatorOf(locator: SessionLocator): SessionLocator {
  return {
    cwd: locator.cwd,
    sessionId: locator.sessionId,
    ...(locator.parentSessionId !== undefined ? { parentSessionId: locator.parentSessionId } : {}),
    ...(locator.parentChain !== undefined ? { parentChain: locator.parentChain } : {}),
  };
}
