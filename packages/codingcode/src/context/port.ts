import { Context } from 'effect';
import type { Effect } from 'effect';
import type { Message } from '../llm/types.js';
import type { SessionRef } from '../session/types.js';
import type { SessionEvent } from '../session/types.js';

import type { AgentError } from '../util/error.js';

export interface CompressResult {
  didCompress: boolean;
  released: number;
  promptEstimate: number;
}

export interface ContextShape {
  /** 取该会话当前给模型的 history。回合内首次调用读一次盘，之后走内存；换回合自动重建 */
  getHistory(ref: SessionRef, model: string): Effect.Effect<Message[], AgentError>;
  /** 把本回合自己写进 transcript 的事件并入内存态（零 IO） */
  absorb(ref: SessionRef, events: readonly SessionEvent[]): Effect.Effect<void>;
  /** 手动压缩入口（HTTP /compact），不受阈值限制 */
  compact(
    ref: SessionRef,
    model: string,
    usage?: number
  ): Effect.Effect<CompressResult, AgentError>;
  /** 会话删除时丢弃缓存 */
  dispose(sessionId: string): Effect.Effect<void>;
}

export class ContextService extends Context.Tag('Context')<ContextService, ContextShape>() {}
