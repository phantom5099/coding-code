import { Context } from 'effect';
import type { Effect } from 'effect';

export type AskAnswer =
  | { readonly status: 'answered'; readonly options: readonly string[]; readonly custom: string | null }
  | { readonly status: 'no_answer' };

export interface AskWaitShape {
  /** 挂起等待该调用 id 的用户回答 */
  waitForAsk(id: string, sessionId: string): Effect.Effect<AskAnswer>;
  /** 用户回答回流；id + sessionId 双键校验，未命中返回 false */
  resolveAsk(id: string, sessionId: string, answer: AskAnswer): Effect.Effect<boolean>;
  /** 会话收尾时按 sessionId 关掉所有待答问题（fail-closed → no_answer），返回清理条数 */
  cancelPendingFor(sessionId: string): Effect.Effect<number>;
  /** 挂起方被打断时清掉等待条目（正常完成时条目已被 resolveAsk 删除，此处为幂等 no-op） */
  forget(id: string): Effect.Effect<boolean>;
}

export class AskWaitService extends Context.Tag('AskWait')<AskWaitService, AskWaitShape>() {}
