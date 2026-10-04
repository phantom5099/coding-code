import { Context } from 'effect';
import type { Effect, Queue } from 'effect';
import type { FrameBody } from '../contracts/frame.js';

export interface EventSinkShape {
  /** 建队列并挂载为该会话的出站队列；调用者即这条帧流的唯一读者。覆盖式：每次调用都换新队列 */
  attach(sessionId: string): Effect.Effect<Queue.Queue<FrameBody>>;
  /** 消费者退出时摘掉挂载；此后 emit 静默丢弃 */
  detach(sessionId: string): Effect.Effect<void>;
  /** 任何模块投帧，插在同一队尾，与回合自己的帧严格全序 */
  emit(sessionId: string, body: FrameBody): Effect.Effect<void>;
  /** 该会话当前是否有消费者（approval 用它判「有没有 UI」） */
  has(sessionId: string): Effect.Effect<boolean>;
}

export class EventSinkService extends Context.Tag('EventSink')<EventSinkService, EventSinkShape>() {}
