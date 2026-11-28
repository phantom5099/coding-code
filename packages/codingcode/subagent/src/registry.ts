import { Context, Effect, Layer } from 'effect';
import { randomUUID } from 'crypto';
import { ASK_BEFORE_EXEC_PERMISSION_MODE, AgentError, type PermissionMode } from '@codingcode/util';
import type { SandboxPolicy } from '@codingcode/sandbox';
import {
  EventSinkService,
  isTurnEnd,
  type EndTransition,
  type FrameBody,
  type SubagentLifecycleStatus,
} from '@codingcode/sink';
import { MailboxService } from '@codingcode/mailbox';
import {
  SUBAGENT_RESULT_PREFIX,
  SessionService,
  childLineageOf,
  type SessionLocator,
  type SubagentResultEvent,
} from '@codingcode/session';
import { estimateTokensForContent } from '@codingcode/context';
import { textPart } from '@codingcode/model';
import { loadConfig } from '@codingcode/infra';
import { HOOK_POINT, HookService } from '@codingcode/hook';
import { TurnRegistryService } from '@codingcode/turn';
import { SubagentRunnerService } from './port.js';

export interface SubagentHandle {
  readonly sessionId: string;
  readonly agentName: string;
}

/** 派发子智能体请求：由 subagent 侧拥有，上层工具直接填充 */
export interface SpawnSubagentRequest {
  readonly prompt: string;
  readonly agentName: string;
  /** 父会话定位值对象（cwd / sessionId / 父自己的 parentSessionId 与 parentChain） */
  readonly parent: SessionLocator;
  readonly parentPermissionMode?: PermissionMode;
  readonly parentPolicy?: SandboxPolicy;
  readonly model: string;
  readonly systemPrompt?: string;
  readonly resumeSessionId?: string;
  readonly description?: string;
}

/** 终态由子会话自己的 finish 写入；本表只负责派发、落盘与投递 */
export interface SubagentRunRegistryShape {
  spawn(req: SpawnSubagentRequest): Effect.Effect<SubagentHandle, AgentError>;
}

export class SubagentRunRegistryService extends Context.Tag('SubagentRunRegistry')<
  SubagentRunRegistryService,
  SubagentRunRegistryShape
>() {}

interface SubagentRun {
  readonly sessionId: string;
  readonly parent: SessionLocator;
  readonly agentName: string;
}

interface SubagentOutcome {
  readonly end: EndTransition;
  readonly content: string;
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

function renderResult(run: SubagentRun, outcome: SubagentOutcome): string {
  const tail =
    outcome.end.reason === 'done'
      ? ''
      : outcome.end.reason === 'aborted'
        ? '\nThe subagent was interrupted. Resume it with resume_agent if the task is still needed.'
        : '\nThe subagent did not finish. Spawn it again if the task is still needed.';
  const body = `${outcome.content}${tail}`;
  return [
    SUBAGENT_RESULT_PREFIX,
    `Task name: ${run.parent.sessionId}`,
    `Sender: ${run.sessionId}`,
    'Payload:',
    truncateToTokens(body, BODY_TOKEN_BUDGET),
  ].join('\n');
}

const failedEnd = (message: string): EndTransition => ({
  to: 'end',
  reason: 'error',
  error: { message, code: 'SUBAGENT_FAILED' },
});

const consume = (stream: AsyncGenerator<FrameBody>) =>
  Effect.tryPromise({
    try: async (): Promise<SubagentOutcome> => {
      let content = '';
      for await (const body of stream) {
        if (body.family === 'event') {
          if (body.event.type === 'text_delta') content += body.event.text;
          continue;
        }
        if (isTurnEnd(body)) {
          const end = body.transition;
          if (end.reason === 'done') {
            return { end, content: content || '(subagent completed without output)' };
          }
          if (end.reason === 'error') return { end, content: end.error.message };
          if (end.reason === 'maxSteps') {
            const message = 'subagent exhausted its step budget before finishing';
            return { end: failedEnd(message), content: message };
          }
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

    const parents = new Set<string>();

    const emitSubagent = (run: SubagentRun, status: SubagentLifecycleStatus) =>
      sink.emit(run.parent.sessionId, {
        family: 'event',
        event: {
          type: 'subagent_event',
          sessionId: run.sessionId,
          agentName: run.agentName,
          status,
        },
      });

    const drainRun = (run: SubagentRun, stream: AsyncGenerator<FrameBody>) =>
      Effect.gen(function* () {
        const settled = yield* Effect.either(consume(stream));
        const outcome: SubagentOutcome =
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

        yield* session.appendEvent(run.parent, event).pipe(Effect.ignore);
        yield* mailbox
          .offer({ recipientSessionId: run.parent.sessionId, item: event })
          .pipe(Effect.ignore);
        yield* turn.markDelivered(run.sessionId);

        const status: 'completed' | 'failed' =
          outcome.end.reason === 'done' ? 'completed' : 'failed';
        yield* emitSubagent(run, status);
        yield* hooks.emit(HOOK_POINT.AGENT_SUBAGENT_COMPLETE, {
          projectPath: run.parent.cwd,
          childSessionId: run.sessionId,
          agentName: run.agentName,
          status,
        });
      });

    const spawn = (req: SpawnSubagentRequest) =>
      Effect.gen(function* () {
        const { parent } = req;
        if (
          (yield* turn.runningChildren(parent.sessionId)) >= loadConfig().subagent.maxBackground
        ) {
          return yield* Effect.fail(
            new AgentError('TOOL_EXECUTION_FAILED', 'Concurrent subagent limit reached')
          );
        }

        const { stream, sessionId } = yield* runner.runSubagent([textPart(req.prompt)], {
          sessionId: req.resumeSessionId,
          cwd: parent.cwd,
          permissionMode: req.parentPermissionMode ?? ASK_BEFORE_EXEC_PERMISSION_MODE,
          sandbox: req.parentPolicy ? { policy: req.parentPolicy } : undefined,
          lineage: childLineageOf(parent),
          subagent: {
            agentName: req.agentName,
            description: req.description,
            systemPrompt: req.systemPrompt,
          },
          model: req.model,
        });

        const run: SubagentRun = { sessionId, parent, agentName: req.agentName };
        parents.add(parent.sessionId);
        yield* emitSubagent(run, 'spawned');

        yield* Effect.forkDaemon(drainRun(run, stream));
        return { sessionId, agentName: req.agentName };
      });

    yield* Effect.addFinalizer(() =>
      Effect.forEach(parents, (parentSessionId) => turn.stopChildren(parentSessionId), {
        discard: true,
      }).pipe(Effect.andThen(Effect.sync(() => parents.clear())))
    );

    return { spawn };
  })
);
