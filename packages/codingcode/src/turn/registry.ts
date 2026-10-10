import { Deferred, Effect, Layer } from 'effect';
import { EventSinkService } from '../sink/port.js';
import { TurnRegistryService } from './port.js';
import type {
  EndReason,
  PendingUserInput,
  TurnClaim,
  TurnCommand,
  TurnState,
  WaitOutcome,
} from './types.js';
import type { EndTransition, Transition } from '../sink/types.js';

interface TurnRecord {
  turnId: number;
  state: TurnState;
  /** 终态时写入 */
  endReason?: EndReason;
  /** 派生关系，子代理并发闸与 stopChildren 按它过滤 */
  parentSessionId?: string;
  agentName?: string;
  /** 回合级 steer 槽；被 drain 取空 */
  pendingUserInputs: PendingUserInput[];
  /** 终态信号，由 settle 完成 */
  ended: Deferred.Deferred<void>;
  /** 投递完成信号（仅委派记录），由 markDelivered 完成 */
  delivered: Deferred.Deferred<void>;
  stop?: () => void;
  /** stopChildren 已请求过停止，避免重复计数 */
  stopping?: boolean;
}

export const TurnRegistryLayer = Layer.effect(
  TurnRegistryService,
  Effect.gen(function* () {
    const sink = yield* EventSinkService;
    const records = new Map<string, TurnRecord>(); // 键 = 会话 sessionId

    /** 相位帧的唯一投递口 */
    const frame = (sessionId: string, transition: Transition) =>
      sink.emit(sessionId, { family: 'transition', transition });

    const project = (rec: TurnRecord): WaitOutcome =>
      rec.state === 'complete' ? 'completed' : 'failed';

    /** 终结：写状态、投 end 帧、唤醒 wait、回收派生条目 */
    const settle = (
      sessionId: string,
      state: TurnState,
      endReason: EndReason,
      end: EndTransition
    ) =>
      Effect.sync(() => {
        const rec = records.get(sessionId);
        if (!rec || rec.state !== 'running') return; // 幂等
        rec.state = state;
        rec.endReason = endReason;

        Effect.runSync(frame(sessionId, end));
        Effect.runSync(Deferred.succeed(rec.ended, void 0));

        // 回收本回合派生的终态条目
        for (const [id, child] of records)
          if (child.parentSessionId === sessionId && child.state !== 'running') records.delete(id);
      });

    /** 转移：状态机的全部出口都在这一个 switch 里 */
    const transition = (sessionId: string, cmd: TurnCommand): Effect.Effect<void> =>
      Effect.gen(function* () {
        switch (cmd.kind) {
          case 'start': {
            const rec = records.get(sessionId);
            if (rec) yield* frame(sessionId, { to: 'start', turnId: rec.turnId });
            return;
          }
          case 'running':
            yield* frame(sessionId, {
              to: 'executing',
              ...(cmd.responded ? { responded: cmd.responded } : {}),
            });
            return;
          case 'compressing':
            yield* frame(sessionId, { to: 'compress' });
            return;
          case 'complete':
            yield* settle(sessionId, 'complete', { kind: cmd.reason }, {
              to: 'end',
              reason: cmd.reason,
            });
            return;
          case 'interrupt':
            yield* settle(sessionId, 'interrupt', { kind: 'aborted' }, {
              to: 'end',
              reason: 'aborted',
            });
            return;
          case 'fail':
            yield* settle(
              sessionId,
              'error',
              { kind: 'error', error: cmd.error },
              { to: 'end', reason: 'error', error: cmd.error }
            );
            return;
          default: {
            // 新增 kind 会在这里编译报错
            const _exhaustive: never = cmd;
            return _exhaustive;
          }
        }
      });

    return {
      claim: (sessionId, c: TurnClaim) =>
        Effect.gen(function* () {
          // 只有 running 算活跃；终态记录可被新回合覆盖
          if (records.get(sessionId)?.state === 'running') return false;
          records.set(sessionId, {
            turnId: c.turnId,
            state: 'running',
            parentSessionId: c.parentSessionId,
            agentName: c.agentName,
            pendingUserInputs: [],
            ended: yield* Deferred.make<void>(),
            delivered: yield* Deferred.make<void>(),
          });
          return true;
        }),

      transition,

      submit: (sessionId, input: PendingUserInput) =>
        Effect.sync(() => {
          const rec = records.get(sessionId);
          if (!rec || rec.state !== 'running') return { kind: 'no-active-turn' as const };
          rec.pendingUserInputs.push(input);
          return { kind: 'attached' as const, turnId: rec.turnId };
        }),

      drain: (sessionId) =>
        Effect.sync(() => {
          const rec = records.get(sessionId);
          if (!rec) return [];
          const out = rec.pendingUserInputs;
          rec.pendingUserInputs = [];
          return out;
        }),

      wait: (sessionId, timeoutMs) =>
        Effect.gen(function* () {
          const rec = records.get(sessionId);
          if (!rec) return undefined;
          const converged = Effect.gen(function* () {
            yield* Deferred.await(rec.ended); // 已终态则立即通过
            // 委派记录：等结果进父会话 mailbox
            if (rec.parentSessionId) yield* Deferred.await(rec.delivered);
            return project(rec);
          });
          return yield* Effect.race(
            Effect.sleep(timeoutMs).pipe(Effect.as<WaitOutcome>('timeout')),
            converged
          );
        }),

      markDelivered: (sessionId) =>
        Effect.sync(() => {
          const rec = records.get(sessionId);
          if (rec) Effect.runSync(Deferred.succeed(rec.delivered, void 0));
        }),

      arm: (sessionId, stop) =>
        Effect.sync(() => {
          const rec = records.get(sessionId);
          if (rec) rec.stop = stop;
        }),

      runningChildren: (parentSessionId) =>
        Effect.sync(() => {
          let n = 0;
          for (const rec of records.values())
            if (rec.parentSessionId === parentSessionId && rec.state === 'running') n++;
          return n;
        }),

      stopChildren: (parentSessionId) =>
        Effect.sync(() => {
          let stopped = 0;
          for (const rec of records.values()) {
            if (rec.parentSessionId !== parentSessionId || rec.state !== 'running') continue;
            if (!rec.stop || rec.stopping) continue; // 未 arm / 已请求过
            rec.stopping = true;
            rec.stop();
            stopped++;
          }
          return stopped;
        }),

      dispose: (sessionId) =>
        Effect.sync(() => {
          records.delete(sessionId);
          for (const [id, rec] of records)
            if (rec.parentSessionId === sessionId) records.delete(id);
        }),
    };
  })
);
