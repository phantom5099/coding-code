import type { TokenUsage } from '@codingcode/model';
import type { PermissionMode } from '@codingcode/util';

/** 工作区 + 会话键：checkpoint / approval / memory / delete 等跨包共用 */
export interface SessionKey {
  readonly cwd: string;
  readonly sessionId: string;
}

/** 派生谱系值对象：父会话与由近及远的祖先链（末位为顶层主会话） */
export interface SessionLineage {
  readonly parentSessionId?: string;
  readonly parentChain?: readonly string[];
}

/** 子智能体附加元信息值对象 */
export interface SubagentMeta {
  readonly agentName?: string;
  readonly description?: string;
  readonly systemPrompt?: string;
}

/** 闭区间回合范围值对象（summary / compact 共用） */
export interface TurnRange {
  readonly startTurnId: number;
  readonly endTurnId: number;
}

/** 会话定位值对象：唯一标识一个会话及其派生谱系 */
export interface SessionLocator extends SessionKey, SessionLineage {}

/** 回合级会话引用：定位值对象 + 当前回合号 */
export interface SessionRef extends SessionLocator {
  readonly currentTurnId: number;
}

/** 会话身份与元信息实体（不含事件判别字段） */
export interface SessionMeta extends SessionLocator, SubagentMeta {
  readonly createdAt: string;
  model: string;
  title: string;
  permissionMode: PermissionMode;
}

/** 列表读模型：会话元信息 + 盘上最新修改时间与用量 */
export interface SessionSummary extends SessionMeta {
  readonly updatedAt: string;
  readonly usage?: TokenUsage;
}

/** 聚合运行态：活跃会话在回合内的可变状态 */
export interface SessionStoreState extends SessionMeta {
  currentTurnId: number;
  memorySnapshot: string;
  usage: TokenUsage | undefined;
}

/** 创建会话的统一命令对象 */
export interface CreateSessionCommand {
  readonly cwd: string;
  readonly model: string;
  readonly title?: string;
  readonly permissionMode: PermissionMode;
  readonly lineage?: SessionLineage;
  readonly subagent?: SubagentMeta;
}

export * from './events.js';
export type { UITurn, UITurnItem } from './view.js';
