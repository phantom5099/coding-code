import { Deferred, Effect, Layer } from 'effect';
import { EventSinkService } from '@codingcode/sink';
import type { EndOutcome, EndTransition, Transition } from '@codingcode/sink';
import { TurnRegistryService } from './port.js';
import type {
  ClaimTurnCommand,
  PendingUserInput,
  TurnCommand,
  TurnState,
  WaitOutcome,
} from './types.js';

interface TurnRecord {
  readonly turnId: number;
  readonly parentSessionId?: string;
  readonly agentName?: string;
  readonly description?: string;
  state: TurnState;
  endOutcome?: EndOutcome;
  /** 回合级 steer 槽；被 drain 取空 */
  pendingUserInputs: PendingUserInput[];
  /** 终态信号，由 settle 完成 */
  readonly ended: Deferred.Deferred<void>;
  /** 投递完成信号（仅委派记录），由 markDelivered 完成 */
  readonly delivered: Deferred.Deferred<void>;
  stop?: () => void;
  /** stopChildren 已请求过停止，避免重复计数 */
  stopping?: boolean;
}

function turnStateOf(outcome: EndOutcome): TurnState {
  if (outcome.reason === 'aborted') return 'interrupt';
  if (outcome.reason === 'error') return 'error';
  return 'complete';
}

export const TurnRegistryLayer = Layer.effect(
  TurnRegistryService,
  Effect.gen(function* () {
    const sink = yield* EventSinkService;
    const records = new Map<string, TurnRecord>();

    const frame = (sessionId: string, transition: Transition) =>
      sink.emit(sessionId, { family: 'transition', transition });

    const project = (rec: TurnRecord): WaitOutcome =>
      rec.state === 'complete' ? 'completed' : 'failed';

    /** 终结：由单一 EndOutcome 派生状态与 end 帧，唤醒 wait 并回收派生条目 */
    const settle = (sessionId: string, outcome: EndOutcome) =>
      Effect.sync(() => {
        const rec = records.get(sessionId);
        if (!rec || rec.state !== 'running') return;
        rec.state = turnStateOf(outcome);
        rec.endOutcome = outcome;

        const end: EndTransition = { to: 'end', ...outcome };
        Effect.runSync(frame(sessionId, end));
        Effect.runSync(Deferred.succeed(rec.ended, void 0));

        for (const [id, child] of records) {
          if (child.parentSessionId === sessionId && child.state !== 'running') {
            records.delete(id);
          }
        }
      });

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
            yield* settle(sessionId, { reason: cmd.reason });
            return;
          case 'interrupt':
            yield* settle(sessionId, { reason: 'aborted' });
            return;
          case 'fail':
            yield* settle(sessionId, { reason: 'error', error: cmd.error });
            return;
          default: {
            const _exhaustive: never = cmd;
            return _exhaustive;
          }
        }
      });

    return {
      claim: (cmd: ClaimTurnCommand) =>
        Effect.gen(function* () {
          if (records.get(cmd.sessionId)?.state === 'running') return false;
          records.set(cmd.sessionId, {
            turnId: cmd.turnId,
            ...(cmd.parentSessionId !== undefined ? { parentSessionId: cmd.parentSessionId } : {}),
            ...(cmd.agentName !== undefined ? { agentName: cmd.agentName } : {}),
            ...(cmd.description !== undefined ? { description: cmd.description } : {}),
            state: 'running',
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
            yield* Deferred.await(rec.ended);
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
            if (!rec.stop || rec.stopping) continue;
            rec.stopping = true;
            rec.stop();
            stopped++;
          }
          return stopped;
        }),

      interrupt: (sessionId) =>
        Effect.sync(() => {
          const rec = records.get(sessionId);
          if (!rec) return 'not-found' as const;
          if (rec.state !== 'running' || !rec.stop || rec.stopping) return 'not-running' as const;
          rec.stopping = true;
          rec.stop();
          return 'stopped' as const;
        }),

      listChildren: (parentSessionId) =>
        Effect.sync(() =>
          [...records.entries()]
            .filter(([, rec]) => rec.parentSessionId === parentSessionId)
            .map(([sessionId, rec]) => ({
              sessionId,
              ...(rec.agentName ? { agentName: rec.agentName } : {}),
              ...(rec.description ? { description: rec.description } : {}),
              state: rec.state,
              turnId: rec.turnId,
            }))
        ),

      dispose: (sessionId) =>
        Effect.sync(() => {
          records.delete(sessionId);
          for (const [id, rec] of records)
            if (rec.parentSessionId === sessionId) records.delete(id);
        }),
    };
  })
);
