import type { FrameError, ResponseMeta } from '../sink/types.js';
import type { IncomingPart } from '../llm/types.js';

/** 状态轴：判活只看这一轴 */
export type TurnState = 'running' | 'complete' | 'interrupt' | 'error';

/** 原因轴：终态上的属性，不参与判活 */
export type EndReason =
  | { readonly kind: 'done' }
  | { readonly kind: 'maxSteps' }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'error'; readonly error: FrameError };

/** 转移集：状态机本体 */
export type TurnCommand =
  | { readonly kind: 'start' }
  | { readonly kind: 'running'; readonly responded?: ResponseMeta }
  | { readonly kind: 'compressing' }
  | { readonly kind: 'complete'; readonly reason: 'done' | 'maxSteps' }
  | { readonly kind: 'interrupt' }
  | { readonly kind: 'fail'; readonly error: FrameError };

/** 回合级待投递用户输入；`id` 由前端在入队时生成，drain 吸收时回显在 `user_input` 帧上 */
export interface PendingUserInput {
  readonly id: string;
  readonly parts: IncomingPart[];
}

/** 提交判定：并入当前回合 / 无活跃回合（由调用方开新回合） */
export type SubmitOutcome =
  | { readonly kind: 'attached'; readonly turnId: number }
  | { readonly kind: 'no-active-turn' };

/** wait 的对外摘要：状态轴的有损投影 + 等待动作的超时 */
export type WaitOutcome = 'completed' | 'failed' | 'timeout';

/** claim 时登记的附加元数据；键是第一个参数 sessionId。派生关系随记录走，父回合为 undefined */
export interface TurnClaim {
  readonly turnId: number;
  readonly parentSessionId?: string;
  readonly agentName?: string;
  /** 子智能体用途描述；list_agents 的投影来源 */
  readonly description?: string;
}

/** listChildren 的条目投影：该父会话名下回合记录的身份与状态 */
export interface ChildTurnSummary {
  readonly sessionId: string;
  readonly agentName?: string;
  readonly description?: string;
  readonly state: TurnState;
  readonly turnId: number;
}
