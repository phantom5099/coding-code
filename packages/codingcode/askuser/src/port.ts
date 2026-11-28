import { Context } from 'effect';
import type { Effect } from 'effect';
import type { PendingCallKey } from '@codingcode/util';

export type AskKey = PendingCallKey;

export type AskAnswer =
  | {
      readonly status: 'answered';
      readonly options: readonly string[];
      readonly custom: string | null;
    }
  | { readonly status: 'no_answer' };

export interface ResolveAskCommand extends AskKey {
  readonly answer: AskAnswer;
}

/** 严格解析回答载荷；无法构成有效回答时 fail-closed 为 no_answer */
export function parseAskAnswer(body: { options?: unknown; custom?: unknown }): AskAnswer {
  const custom = typeof body.custom === 'string' ? body.custom : '';
  const raw = Array.isArray(body.options) ? body.options : [];
  const options = raw.filter(
    (item): item is string => typeof item === 'string' && /^[A-D]$/.test(item)
  );
  if (options.length === 0 && custom.trim() === '') return { status: 'no_answer' };
  return { status: 'answered', options, custom: custom.trim() || null };
}

export interface AskWaitShape {
  /** 挂起等待该调用 id 的用户回答 */
  waitForAsk(key: AskKey): Effect.Effect<AskAnswer>;
  /** 用户回答回流；callId + sessionId 双键校验，未命中返回 false */
  resolveAsk(cmd: ResolveAskCommand): Effect.Effect<boolean>;
  /** 会话收尾时按 sessionId 关掉所有待答问题（fail-closed → no_answer），返回清理条数 */
  cancelPendingFor(sessionId: string): Effect.Effect<number>;
  /** 挂起方被打断时清掉等待条目（正常完成时条目已被 resolveAsk 删除，此处为幂等 no-op） */
  forget(callId: string): Effect.Effect<boolean>;
}

export class AskWaitService extends Context.Tag('AskWait')<AskWaitService, AskWaitShape>() {}
