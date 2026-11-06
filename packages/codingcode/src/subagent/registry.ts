import { Context, Effect, Layer } from 'effect';
import { randomUUID } from 'crypto';
import { AgentError } from '../util/error.js';
import { isTurnEnd } from '../sink/types.js';
import type { EndTransition, FrameBody } from '../sink/types.js';
import { BYPASS_PERMISSION_MODE, type ProfileName } from '../util/enums.js';
import { SUBAGENT_RESULT_PREFIX } from '../session/types.js';
import type { SubagentResultEvent } from '../session/types.js';
import { transcriptPathOf } from '../session/paths.js';
import { estimateTokensForContent } from '../context/tokens.js';
import { textPart } from '../llm/types.js';
import { loadConfig } from '../infra/config.js';

import { MailboxService } from '../session/mailbox.js';
import { SessionService } from '../session/port.js';
import { EventSinkService } from '../sink/port.js';
import { HookService } from '../hooks/port.js';
import { TurnRegistryService } from '../turn/port.js';
import { SubagentRunnerService } from './port.js';

export interface SpawnOptions {
  prompt: string;
  agentName: string;
  parentSessionId: string;
  parentCwd: string;
  parentProfile: ProfileName;
  /** 已由调用方解析过的模型 id（含清单校验与父模型回退） */
  model: string;
  systemPrompt?: string;
  /** 续跑：复用既有子会话与其历史上下文；缺省即新建会话 */
  resumeSessionId?: string;
  /** 首次派发的用途描述；续跑不传（meta 已有） */
  description?: string;
  /**
   * 祖先会话 id，由近及远，首位即 `parentSessionId`；子会话回合的工具上下文由此而来，
   * 父会话自己的转录位置也由其余位推出（见 parentTranscriptOf）
   */
  parentChain: readonly string[];
}

/** 终态由子会话自己的 finish 写入；本表只负责派发、落盘与投递 */
export interface SubagentRunRegistryShape {
  spawn(opts: SpawnOptions): Effect.Effect<{ sessionId: string; agentName: string }, AgentError>;
}

export class SubagentRunRegistryService extends Context.Tag('SubagentRunRegistry')<
  SubagentRunRegistryService,
  SubagentRunRegistryShape
>() {}

interface SubagentRun {
  readonly sessionId: string;
  readonly parentSessionId: string;
  readonly parentCwd: string;
  readonly agentName: string;
  /** 父会话自己的转录：结果在投递点就写进这里，不等父回合 drain */
  readonly parentTranscriptPath: string;
}

/**
 * 父会话自己的转录位置。链首位就是父，故父的「父 id」与祖链都是本链去掉首位。
 * 转录目录由链末位（顶层会话）定位，子代理之间不逐层嵌套，所以父本身是子智能体时
 * 与它的父平级：顶层父（链长 1）⇒ `sessions/<parent>.jsonl`，
 * 否则 ⇒ `sessions/<链末位>/subagents/<parent>.jsonl`。
 */
const parentTranscriptOf = (opts: SpawnOptions): string =>
  transcriptPathOf(
    opts.parentCwd,
    opts.parentSessionId,
    opts.parentChain[1],
    opts.parentChain.slice(1)
  );

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
  const tail =
    outcome.end.reason === 'done'
      ? ''
      : outcome.end.reason === 'aborted'
        ? '\nThe subagent was interrupted. Resume it with resume_agent if the task is still needed.'
        : '\nThe subagent did not finish. Spawn it again if the task is still needed.';
  const body = `${outcome.content}${tail}`;
  return [
    SUBAGENT_RESULT_PREFIX,
    `Task name: ${run.parentSessionId}`,
    `Sender: ${run.sessionId}`,
    'Payload:',
    truncateToTokens(body, BODY_TOKEN_BUDGET),
  ].join('\n');
}

/** 非 done 的终态统一归一成一条 error 帧，形状仍是帧契约的 end */
const failedEnd = (message: string): EndTransition => ({
  to: 'end',
  reason: 'error',
  error: { message, code: 'SUBAGENT_FAILED' },
});

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
          if (end.reason === 'done')
            return { end, content: content || '(subagent completed without output)' };
          if (end.reason === 'error') return { end, content: end.error.message };
          if (end.reason === 'maxSteps') {
            const message = 'subagent exhausted its step budget before finishing';
            return { end: failedEnd(message), content: message };
          }
          // aborted：保留原始 end transition，让中断与一般失败在 renderResult 里仍可区分
          const message = content || 'subagent was aborted';
          return { end, content: message };
        }
      }
      const message = 'subagent stream ended without a terminal frame';
      return { end: failedEnd(message), content: message };
    },
    catch: (e) =>
      new AgentError('TOOL_EXECUTION_FAILED', e instanceof Error ? e.message : String(e)),
  });

export const SubagentRunRegistryLayer = Layer.scoped(
  SubagentRunRegistryService,
  Effect.gen(function* () {
    const mailbox = yield* MailboxService;
    const runner = yield* SubagentRunnerService;
    const session = yield* SessionService;
    const sink = yield* EventSinkService;
    const hooks = yield* HookService;
    const turn = yield* TurnRegistryService;

    /** 曾派发过子会话的父会话 id，仅用于 layer 终结时请求停止 */
    const parents = new Set<string>();

    /** 帧直投父会话的出站队列：EventSink 的键就是收件人会话，不需要任何回调透传 */
    const emitSubagent = (
      parentSessionId: string,
      sessionId: string,
      agentName: string,
      status: 'spawned' | 'completed' | 'failed'
    ) =>
      sink.emit(parentSessionId, {
        family: 'event',
        event: { type: 'subagent_event', sessionId, agentName, status },
      });

    // 先落盘再入队：盘是事实源，队列只是本回合的唤醒通道。
    // 父回合提前结束、进程退出都不会丢结果 —— 换回合重建上下文时从父转录读回。
    const drainRun = (run: SubagentRun, stream: AsyncGenerator<FrameBody, unknown, unknown>) =>
      Effect.gen(function* () {
        const settled = yield* Effect.either(consume(stream));
        const outcome =
          settled._tag === 'Right'
            ? settled.right
            : { end: failedEnd(settled.left.message), content: settled.left.message };

        const event: SubagentResultEvent = {
          type: 'subagent_result',
          uuid: randomUUID(),
          sessionId: run.sessionId,
          agentName: run.agentName,
          content: renderResult(run, outcome),
        };

        // 落盘失败仍投递：退化成本回合可见、崩溃不可恢复，不影响父回合继续
        yield* session.appendEvent(run.parentTranscriptPath, event).pipe(Effect.ignore);
        yield* mailbox.offer(run.parentSessionId, event).pipe(Effect.ignore);

        // 终态由子会话自己的 finish 写入（turn.transition）；这里只补投递信号，
        // 让 wait 在"结果已落盘且已进父会话 mailbox"之后才返回
        yield* turn.markDelivered(run.sessionId);
        yield* emitSubagent(
          run.parentSessionId,
          run.sessionId,
          run.agentName,
          outcome.end.reason === 'done' ? 'completed' : 'failed'
        );
        yield* hooks.emit('agent.subagent.complete', {
          projectPath: run.parentCwd,
          childSessionId: run.sessionId,
          agentName: run.agentName,
          status: outcome.end.reason === 'done' ? 'completed' : 'failed',
        });
      });

    const spawn = (opts: SpawnOptions) =>
      Effect.gen(function* () {
        if (
          (yield* turn.runningChildren(opts.parentSessionId)) >= loadConfig().subagent.maxBackground
        ) {
          return yield* Effect.fail(
            new AgentError('TOOL_EXECUTION_FAILED', 'Concurrent subagent limit reached')
          );
        }

        // 子会话的可停性由 runTurn 的 arm 登记的 Fiber.interrupt 承担
        const { stream, sessionId } = yield* runner.runSubagent([textPart(opts.prompt)], {
          sessionId: opts.resumeSessionId, // 续跑：复用既有子会话与历史上下文
          cwd: opts.parentCwd,
          activeProfile: opts.parentProfile,
          permissionMode: BYPASS_PERMISSION_MODE,
          parentSessionId: opts.parentSessionId,
          agentName: opts.agentName,
          description: opts.description,
          parentChain: opts.parentChain,
          model: opts.model,
          systemPrompt: opts.systemPrompt,
        });

        const run: SubagentRun = {
          sessionId,
          parentSessionId: opts.parentSessionId,
          parentCwd: opts.parentCwd,
          agentName: opts.agentName,
          parentTranscriptPath: parentTranscriptOf(opts),
        };
        parents.add(opts.parentSessionId);
        yield* emitSubagent(opts.parentSessionId, sessionId, opts.agentName, 'spawned');

        yield* Effect.forkDaemon(drainRun(run, stream));
        return { sessionId, agentName: opts.agentName };
      });

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        // 终态归属由 turn 的记录承担；这里只请求停止本层仍在跑的派生会话
        for (const parentSessionId of parents) void turn.stopChildren(parentSessionId);
        parents.clear();
      })
    );

    return { spawn };
  })
);
