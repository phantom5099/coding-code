import { Context } from 'effect';
import type { Effect } from 'effect';
import type {
  PendingUserInput,
  SubmitOutcome,
  TurnClaim,
  TurnCommand,
  WaitOutcome,
} from './types.js';

export interface TurnRegistryShape {
  // —— 出生 ——
  /** 出生登记：已有 running 记录 → false */
  claim(sessionId: string, claim: TurnClaim): Effect.Effect<boolean>;

  // —— 转移（状态机本体：一次调用写表并投帧）——
  /** `kind: 'start'` 须在 sink.attach 之后 */
  transition(sessionId: string, cmd: TurnCommand): Effect.Effect<void>;

  // —— steer 输入槽 ——
  /** 提交判定：running 则入槽；`id` 由前端提供，回显在 `user_input` 帧上 */
  submit(sessionId: string, input: PendingUserInput): Effect.Effect<SubmitOutcome>;
  /** 取走全部待投递输入 */
  drain(sessionId: string): Effect.Effect<ReadonlyArray<PendingUserInput>>;

  // —— 查询与停止 ——
  /** 等终态；未知 id → undefined，超时 → 'timeout' */
  wait(sessionId: string, timeoutMs: number): Effect.Effect<WaitOutcome | undefined>;
  /** 结果已进父会话 mailbox，唤醒 wait */
  markDelivered(sessionId: string): Effect.Effect<void>;
  /** 登记停止句柄（runFork 之后紧邻调用） */
  arm(sessionId: string, stop: () => void): Effect.Effect<void>;
  /** 该父会话下仍在跑的派生会话数 */
  runningChildren(parentSessionId: string): Effect.Effect<number>;
  /** 停掉该父会话下所有派生会话 */
  stopChildren(parentSessionId: string): Effect.Effect<number>;
  /** 会话删除时清空（含派生条目） */
  dispose(sessionId: string): Effect.Effect<void>;
}

export class TurnRegistryService extends Context.Tag('TurnRegistry')<
  TurnRegistryService,
  TurnRegistryShape
>() {}
