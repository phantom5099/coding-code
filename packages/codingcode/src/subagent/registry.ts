import { Context, Effect, Fiber, Layer, Option, Stream, SubscriptionRef } from 'effect';
import { AgentError } from '../core/error.js';
import { isTurnEnd } from '../contracts/frame.js';
import type { EndTransition, FrameBody } from '../contracts/frame.js';
import type { ProfileName } from '../contracts/types.js';
import { estimateTokensForContent } from '../context/tokens.js';
import { loadConfig } from '../infra/config.js';
import { SUBAGENT_RESULT_PREFIX } from '../contracts/session.js';
import { MailboxService } from '../session/mailbox.js';
import { EventSinkService } from '../sink/port.js';
import { SubagentRunnerService } from './port.js';

export type SubagentRunStatus =
  | { readonly kind: 'running' }
  | { readonly kind: 'ended'; readonly end: EndTransition };

/** wait 只回信号、不回内容 —— 内容已由父回合 drain 时写进父 transcript */
export type WaitOutcome = 'completed' | 'failed' | 'timeout';

export const SUBAGENT_WAIT_MIN_MS = 10_000;
export const SUBAGENT_WAIT_DEFAULT_MS = 30_000;
export const SUBAGENT_WAIT_MAX_MS = 3_600_000;

export interface SpawnOptions {
  prompt: string;
  agentName: string;
  parentSessionId: string;
  parentCwd: string;
  parentProfile: ProfileName;
  /** 已由调用方解析过的模型 id（含清单校验与父模型回退） */
  model: string;
  systemPrompt?: string;
}

export interface SubagentRunRegistryShape {
  spawn(opts: SpawnOptions): Effect.Effect<{ sessionId: string; agentName: string }, AgentError>;
  wait(sessionId: string, timeoutMs: number): Effect.Effect<WaitOutcome, AgentError>;
  stopAll(parentSessionId: string): Effect.Effect<number>;
}

export class SubagentRunRegistryService extends Context.Tag('SubagentRunRegistry')<
  SubagentRunRegistryService,
  SubagentRunRegistryShape
>() {}

interface SubagentRun {
  readonly sessionId: string;
  readonly parentSessionId: string;
  readonly agentName: string;
  readonly status: SubscriptionRef.SubscriptionRef<SubagentRunStatus>;
  readonly abort: AbortController;
  fiber?: Fiber.Fiber<unknown, never>;
}

const BODY_TOKEN_BUDGET = 900;

/** 二分收敛到不超过预算的最长前缀，避免逐字扫描 */
function truncateToTokens(text: string, budget: number): string {
  if (estimateTokensForContent(text) <= budget) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (estimateTokensForContent(text.slice(0, mid)) <= budget) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}\n…[truncated]`;
}

function renderResult(run: SubagentRun, outcome: { end: EndTransition; content: string }): string {
  const body = outcome.end.reason === 'done'
    ? outcome.content
    : `${outcome.content}\nThe subagent did not finish. Spawn it again if the task is still needed.`;
  return [
    SUBAGENT_RESULT_PREFIX,
    `Task name: ${run.parentSessionId}`,
    `Sender: ${run.sessionId}`,
    'Payload:',
    truncateToTokens(body, BODY_TOKEN_BUDGET),
  ].join('\n');
}

/** 非 done 的终态统一归一成一条 error 帧，形状仍是帧契约的 end */
const failedEnd = (message: string): EndTransition =>
  ({ to: 'end', reason: 'error', error: { message, code: 'SUBAGENT_FAILED' } });

/** 帧流的唯一读者：攒 text_delta 取最终输出，认 isTurnEnd 拿终态，其余帧丢弃 */
const consume = (stream: AsyncGenerator<FrameBody, unknown, unknown>) =>
  Effect.tryPromise({
    try: async (): Promise<{ end: EndTransition; content: string }> => {
      let content = '';
      for await (const body of stream) {
        if (body.family === 'event') {
          if (body.event.type === 'text_delta') content += body.event.text;
          continue;
        }
        if (isTurnEnd(body)) {
          const end = body.transition;
          if (end.reason === 'done') return { end, content: content || '(subagent completed without output)' };
          if (end.reason === 'error') return { end, content: end.error.message };
          const message = end.reason === 'maxSteps'
            ? 'subagent exhausted its step budget before finishing'
            : 'subagent was aborted';
          return { end: failedEnd(message), content: message };
        }
      }
      const message = 'subagent stream ended without a terminal frame';
      return { end: failedEnd(message), content: message };
    },
    catch: (e) => new AgentError('TOOL_EXECUTION_FAILED', e instanceof Error ? e.message : String(e)),
  });

export const SubagentRunRegistryLayer = Layer.scoped(
  SubagentRunRegistryService,
  Effect.gen(function* () {
    const mailbox = yield* MailboxService;
    const runner = yield* SubagentRunnerService;
    const sink = yield* EventSinkService;
    const runs = new Map<string, SubagentRun>();   // 键 = 子会话 sessionId；parentSessionId 只是条目上的字段

    /** 帧直投父会话的出站队列：EventSink 的键就是收件人会话，不需要任何回调透传 */
    const emitSubagent = (
      parentSessionId: string, sessionId: string, agentName: string,
      status: 'spawned' | 'completed' | 'failed',
    ) => sink.emit(parentSessionId, {
      family: 'event',
      event: { type: 'subagent_event', sessionId, agentName, status },
    });

    /** 同步读当前值：SubscriptionRef 的 get 随时可读、读不走 */
    const currentStatus = (run: SubagentRun): SubagentRunStatus =>
      Effect.runSync(SubscriptionRef.get(run.status));

    const countRunning = (parentSessionId: string): number => {
      let n = 0;
      for (const run of runs.values()) {
        if (run.parentSessionId === parentSessionId && currentStatus(run).kind === 'running') n++;
      }
      return n;
    };

    // 只入队，不写盘：写盘由父回合在自己的 drain 点做（父回合循环手里才有 state）
    const drainRun = (run: SubagentRun, stream: AsyncGenerator<FrameBody, unknown, unknown>) =>
      Effect.gen(function* () {
        const settled = yield* Effect.either(consume(stream));
        const outcome = settled._tag === 'Right'
          ? settled.right
          : { end: failedEnd(settled.left.message), content: settled.left.message };

        yield* mailbox.offer(run.parentSessionId, {
          type: 'subagent_result',
          sessionId: run.sessionId,
          agentName: run.agentName,
          content: renderResult(run, outcome),
        }).pipe(Effect.ignore);

        yield* SubscriptionRef.set(run.status, { kind: 'ended', end: outcome.end });
        yield* emitSubagent(
          run.parentSessionId, run.sessionId, run.agentName,
          outcome.end.reason === 'done' ? 'completed' : 'failed',
        );
      });

    const spawn = (opts: SpawnOptions) =>
      Effect.gen(function* () {
        if (countRunning(opts.parentSessionId) >= loadConfig().subagent.maxBackground) {
          return yield* Effect.fail(
            new AgentError('TOOL_EXECUTION_FAILED', 'Concurrent subagent limit reached')
          );
        }

        const abort = new AbortController();
        const { stream, sessionId } = yield* runner.runSubagent(opts.prompt, {
          cwd: opts.parentCwd,
          signal: abort.signal,          // 子代理自己的 signal，与父回合无关
          activeProfile: opts.parentProfile,
          permissionMode: 'bypass',
          parentSessionId: opts.parentSessionId,
          agentName: opts.agentName,
          model: opts.model,
          systemPrompt: opts.systemPrompt,
        });

        const status = yield* SubscriptionRef.make<SubagentRunStatus>({ kind: 'running' });
        const run: SubagentRun = {
          sessionId, parentSessionId: opts.parentSessionId, agentName: opts.agentName,
          status, abort,
        };
        runs.set(sessionId, run);
        yield* emitSubagent(opts.parentSessionId, sessionId, opts.agentName, 'spawned');

        run.fiber = yield* Effect.forkDaemon(drainRun(run, stream));
        return { sessionId, agentName: opts.agentName };
      });

    const wait = (sessionId: string, timeoutMs: number): Effect.Effect<WaitOutcome, AgentError> =>
      Effect.gen(function* () {
        const run = runs.get(sessionId);
        if (!run) {
          return yield* Effect.fail(new AgentError('TOOL_EXECUTION_FAILED', `Unknown subagent: ${sessionId}`));
        }
        // 等状态通道的后续值；changes 的首次发射即当前值 ⇒ 已终态的 run 立即返回
        const settled = run.status.changes.pipe(
          Stream.filterMap((s) => s.kind === 'ended' ? Option.some(s.end) : Option.none<EndTransition>()),
          Stream.runHead,
          Effect.map((opt): WaitOutcome =>
            Option.isNone(opt) ? 'timeout' : (opt.value.reason === 'done' ? 'completed' : 'failed')
          )
        );

        return yield* Effect.race(
          Effect.sleep(timeoutMs).pipe(Effect.as<WaitOutcome>('timeout')),
          settled
        );
      });

    const stopAll = (parentSessionId: string): Effect.Effect<number> =>
      Effect.sync(() => {
        let stopped = 0;
        for (const run of runs.values()) {
          if (run.parentSessionId !== parentSessionId) continue;
          if (run.abort.signal.aborted) continue;        // 已请求过停止，不重复计数
          if (currentStatus(run).kind !== 'running') continue;
          run.abort.abort();
          stopped++;
        }
        return stopped;
      });

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const run of runs.values()) {
          run.abort.abort();
          if (run.fiber) Effect.runFork(Fiber.interrupt(run.fiber));
        }
        runs.clear();
      })
    );

    return { spawn, wait, stopAll };
  })
);
