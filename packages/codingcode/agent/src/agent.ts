import { Cause, Effect, Either, Fiber, Layer, Option, Stream } from 'effect';
import { randomUUID } from 'node:crypto';
import {
  AgentError,
  Result,
  normalizePath,
  projectConfigScope,
  sniffMediaMime,
  type PermissionMode,
} from '@codingcode/util';
import { AgentService, ToolEnvPort, type RunTurnOptions, type SandboxConfig } from './port.js';
import { ApprovalService } from '@codingcode/approval';
import { CheckpointService } from '@codingcode/checkpoint';
import { ContextService } from '@codingcode/context';
import { EventSinkService, isTurnEnd, type FrameBody, type FrameError, type ResponseMeta, type ToolOutcome } from '@codingcode/sink';
import { TurnRegistryService } from '@codingcode/turn';
import { MailboxService } from '@codingcode/mailbox';
import {
  SessionService,
  sessionLocatorOf,
  sessionRefOf,
  type SessionKey,
  type SessionRef,
  type SessionStoreState,
} from '@codingcode/session';
import { HOOK_POINT, HookService } from '@codingcode/hook';
import {
  LLMService,
  capabilitiesOf,
  mediaKindOf,
  textOf,
  textPart,
  type IncomingPart,
  type ToolCall,
} from '@codingcode/model';
import { McpService } from '@codingcode/mcp';
import { MemoryService } from '@codingcode/memory';
import { RulesService } from '@codingcode/rules';
import { SkillService } from '@codingcode/skill';
import { ToolExecutorService, type ToolBatchContext, type ToolCatalog, type ToolResult } from '@codingcode/tool';
import { BUILD_PROMPT, buildSystemPrompt, renderSkillBlock } from './prompt.js';
import type { TodoItem } from '@codingcode/todo';
import { loadConfig, createLogger } from '@codingcode/infra';

interface AgentLoopContext {
  readonly state: SessionStoreState;
  readonly model: string;
  readonly abortSignal: AbortSignal | undefined;
  readonly catalog: ToolCatalog;
  readonly rulesText: string;
  readonly permissionMode: PermissionMode;
  readonly sandbox?: SandboxConfig;
  readonly systemPrompt?: string;
  readonly emit: (body: FrameBody) => void;
}

function toolOutcomeOf(result: ToolResult): ToolOutcome {
  return result.status === 'denied'
    ? { status: 'denied', reason: result.reason }
    : { status: result.status, output: result.output };
}

function assertMediaAllowed(
  input: readonly IncomingPart[],
  model: string
): Effect.Effect<void, AgentError> {
  return Effect.gen(function* () {
    let needsVision = false;
    let needsAudio = false;
    for (const p of input) {
      if (p.type !== 'media') continue;
      const mimeType = sniffMediaMime(p.bytes) ?? p.declaredMimeType ?? '';
      if (mediaKindOf(mimeType) === 'audio') needsAudio = true;
      else needsVision = true;
    }
    if (!needsVision && !needsAudio) return;

    const caps = yield* Effect.try({
      try: () => capabilitiesOf(model),
      catch: (e) => (e instanceof AgentError ? e : AgentError.invalidInput(String(e))),
    });
    if (needsVision && !caps.vision) {
      return yield* Effect.fail(
        AgentError.invalidInput('model does not accept image or PDF input')
      );
    }
    if (needsAudio && !caps.audio) {
      return yield* Effect.fail(AgentError.invalidInput('model does not accept audio input'));
    }
  });
}

const logger = createLogger();

function toFrameError(e: AgentError): FrameError {
  return { message: e.message, code: e.code };
}

function causeToFrameError(cause: Cause.Cause<AgentError>): FrameError {
  const failure = Cause.failureOption(cause);
  if (Option.isSome(failure)) return toFrameError(failure.value);
  return { message: Cause.pretty(cause), code: 'AGENT_TERMINATED' };
}

export const AgentLayer = Layer.effect(
  AgentService,
  Effect.gen(function* () {
    const session = yield* SessionService;
    const executor = yield* ToolExecutorService;
    const checkpoint = yield* CheckpointService;
    const hooks = yield* HookService;
    const approval = yield* ApprovalService;
    const skills = yield* SkillService;
    const mcp = yield* McpService;
    const context = yield* ContextService;
    const sink = yield* EventSinkService;
    const turn = yield* TurnRegistryService;
    const mailbox = yield* MailboxService;
    const memory = yield* MemoryService;
    const llm = yield* LLMService;
    const rules = yield* RulesService;
    const toolEnvPort = yield* ToolEnvPort;
    const cfg = loadConfig();
    const maxSteps = cfg.maxSteps ?? 250;
    const maxStopContinuations = cfg.maxStopContinuations ?? 3;

    const flushMemoryInBackground = (locator: SessionKey, model: string) =>
      Effect.forkDaemon(
        memory
          .flushSessionToMemory({ session: locator, model })
          .pipe(
            Effect.catchAllCause((cause) =>
              Effect.sync(() => logger.error('memory flush failed:', cause))
            )
          )
      );

    const runTurn = (input: readonly IncomingPart[], opts: RunTurnOptions) =>
      Effect.gen(function* () {
        const normalizedCwd = normalizePath(opts.cwd);

        // 提交判定：命中活跃回合 → 输入进状态表，直接返回，不开回合
        if (opts.sessionId) {
          const verdict = yield* turn.submit(opts.sessionId, {
            id: opts.inputId ?? randomUUID(),
            parts: input,
          });
          if (verdict.kind === 'attached') {
            return {
              kind: 'queued' as const,
              sessionId: opts.sessionId,
              turnId: verdict.turnId,
            };
          }
        }

        yield* rules.evictProjectRules(normalizedCwd);
        yield* hooks.reloadUserHooks(normalizedCwd);
        yield* hooks.emit(HOOK_POINT.AGENT_TURN_START, { sessionId: '', projectPath: normalizedCwd });
        yield* mcp.syncConnections(normalizedCwd);

        const model = opts.model;
        let state: SessionStoreState;
        if (!opts.sessionId) {
          if (!opts.permissionMode) {
            return yield* Effect.fail(
              new AgentError('CONFIG_MISSING', 'new session requires permissionMode')
            );
          }
          state = yield* session.create({
            cwd: normalizedCwd,
            model,
            title: textOf(input) || 'New session',
            permissionMode: opts.permissionMode,
            lineage: opts.lineage,
            subagent: opts.subagent,
          });
        } else {
          state = yield* session.load({
            ...opts.lineage,
            cwd: normalizedCwd,
            sessionId: opts.sessionId,
          });
        }

        const sid = state.sessionId;
        const turnId = state.currentTurnId + 1;

        // 先于任何落盘：409 的 loser 不写 transcript、不建 checkpoint
        if (
          !(yield* turn.claim({
            sessionId: sid,
            turnId,
            parentSessionId: state.parentSessionId,
            agentName: state.agentName,
            description: state.description,
          }))
        ) {
          return yield* Effect.fail(new AgentError('TURN_CONFLICT', 'concurrent turn on session'));
        }

        return yield* Effect.gen(function* () {
          const effectivePerm = opts.permissionMode ?? state.permissionMode;
          if (opts.permissionMode) {
            yield* session.setPermissionMode(sessionLocatorOf(state), opts.permissionMode);
          }
          state.memorySnapshot = yield* memory.loadMemoryForPrompt(state.cwd);

          const mcpTools = yield* mcp.listProjectMcpTools(normalizedCwd);
          const catalog = yield* executor.prepare(mcpTools);

          const toolEnv = yield* toolEnvPort.getToolEnv();

          yield* assertMediaAllowed(input, model);
          const parts = yield* session.materializeInput(state, input);
          yield* session.recordUser(state, parts);

          if (opts.skills?.length) {
            const all = yield* skills.getAll(projectConfigScope(state.cwd));
            const chosen = all.filter((s) => opts.skills!.some((m) => m.path === s.skillPath));
            if (chosen.length) {
              const entries = yield* Effect.forEach(chosen, (s) =>
                skills.readContent(s.skillPath).pipe(Effect.map((body) => ({ skill: s, body })))
              );
              yield* session.recordSystem(state, [textPart(renderSkillBlock(entries))]);
            }
          }

          const rulesText = yield* rules.getAllRules(state.cwd);

          const q = yield* sink.attach(sid);
          const emit = (body: FrameBody) => Effect.runSync(sink.emit(sid, body));

          // 出生帧须在 attach 之后
          yield* turn.transition(sid, { kind: 'start' });

          const program = agentLoopInternal({
            state,
            model,
            catalog,
            rulesText,
            abortSignal: opts.signal,
            permissionMode: effectivePerm,
            sandbox: opts.sandbox,
            systemPrompt: opts.subagent?.systemPrompt,
            emit,
          });
          const fiber = Effect.runFork(toolEnv.provide(program));
          if (opts.signal) {
            opts.signal.addEventListener('abort', () => Effect.runFork(Fiber.interrupt(fiber)), {
              once: true,
            });
            if (opts.signal.aborted) Effect.runFork(Fiber.interrupt(fiber));
          }
          yield* turn.arm(sid, () => Effect.runFork(Fiber.interrupt(fiber)));

          const stream = (async function* () {
            try {
              for await (const body of Stream.toAsyncIterable(
                Stream.fromQueue(q).pipe(Stream.takeUntil((b: FrameBody) => isTurnEnd(b)))
              ) as AsyncIterable<FrameBody>) {
                yield body;
              }
            } finally {
              Effect.runSync(sink.detach(sid));
            }
          })();

          return { kind: 'turn' as const, stream, sessionId: sid };
        }).pipe(
          Effect.onError((cause) =>
            turn
              .transition(sid, {
                kind: 'fail',
                error: causeToFrameError(cause),
              })
              .pipe(Effect.ignore)
          ),
          Effect.onInterrupt(() =>
            turn
              .transition(sid, {
                kind: 'fail',
                error: { message: 'turn aborted before start', code: 'AGENT_TERMINATED' },
              })
              .pipe(Effect.ignore)
          )
        );
      });

    function agentLoopInternal(
      loop: AgentLoopContext
    ): Effect.Effect<Result<string, AgentError>, AgentError> {
      const { state, model, abortSignal, catalog, rulesText, permissionMode, sandbox, emit } = loop;
      const sid = state.sessionId;
      const projectPath = state.cwd;
      const sessionKey: SessionKey = { cwd: projectPath, sessionId: sid };
      const { tools, lookup: toolLookup } = catalog;

      const emitTurnEnd = (status: 'done' | 'error' | 'maxSteps' | 'aborted') =>
        hooks.emit(HOOK_POINT.AGENT_TURN_END, {
          sessionId: sid,
          turnId: state.currentTurnId,
          status,
          projectPath,
        });

      return Effect.gen(function* () {
        const basePrompt = buildSystemPrompt({
          cwd: projectPath,
          platform: process.platform,
          shell: process.env.SHELL || process.env.ComSpec || 'bash',
          rules: rulesText,
          customSystemPrompt: loop.systemPrompt ?? BUILD_PROMPT,
        });

        const memoryBlock = state.memorySnapshot;
        const memorySection = memoryBlock ? `## Session Memory\n\n${memoryBlock}` : '';
        const system = [basePrompt, memorySection].filter(Boolean).join('\n\n');

        let stopContinuations = 0;
        let lastResult: Result<string, AgentError> | null = null;
        const sessionRef: SessionRef = sessionRefOf(state);

        const absorbPendingInputs = () =>
          Effect.gen(function* () {
            let n = 0;
            for (const ui of yield* turn.drain(sid)) {
              yield* assertMediaAllowed(ui.parts, model);
              const stored = yield* session.materializeInput(state, ui.parts);
              const ev = yield* session.recordUserInput(state, stored);
              yield* context.absorb(sessionRef, [ev]);
              emit({ family: 'event', event: { type: 'user_input', id: ui.id, parts: stored } });
              n++;
            }
            return n;
          });

        yield* hooks.emit(HOOK_POINT.AGENT_TURN_START, { sessionId: sid, projectPath });

        for (let step = 0; step < maxSteps; step++) {
          yield* hooks.emitDecision(HOOK_POINT.AGENT_STEP_BEFORE, {
            sessionId: sid,
            step: step + 1,
            projectPath,
          });

          if (step === 0) {
            yield* turn.transition(sid, { kind: 'running' });
          }

          let drainedCount = yield* absorbPendingInputs();

          if (step > 0) {
            const items = yield* mailbox.drain(sid);
            if (items.length > 0) {
              yield* context.absorb(sessionRef, items);
              drainedCount += items.length;
            }
          }

          const history = yield* Effect.either(
            context.getHistory({ session: sessionRef, model })
          );
          if (Either.isLeft(history)) {
            yield* turn.transition(sid, { kind: 'fail', error: toFrameError(history.left) });
            yield* emitTurnEnd('error');
            return Result.err(history.left);
          }

          const llmMessages = [...history.right];
          let content = '';
          let reasoningText = '';
          let reasoningProvider = '';
          const toolCalls: ToolCall[] = [];
          let responded: ResponseMeta = {};

          const streamed = yield* Effect.either(
            Effect.tryPromise({
              try: async () => {
                for await (const part of llm.completeStream({
                  messages: llmMessages,
                  system,
                  tools,
                  maxSteps: 1,
                  model,
                  signal: abortSignal,
                })) {
                  if (abortSignal?.aborted) break;
                  if (part.type === 'reasoning') {
                    reasoningText += part.text;
                    reasoningProvider = part.provider;
                    emit({ family: 'event', event: { type: 'reasoning_delta', text: part.text } });
                  } else if (part.type === 'text') {
                    content += part.text;
                    emit({ family: 'event', event: { type: 'text_delta', text: part.text } });
                  } else if (part.type === 'tool_call') {
                    toolCalls.push({ id: part.id, name: part.name, arguments: part.arguments });
                    emit({
                      family: 'event',
                      event: {
                        type: 'tool_call',
                        id: part.id,
                        name: part.name,
                        arguments: part.arguments,
                      },
                    });
                  } else {
                    responded = part.usage ? { usage: part.usage } : {};
                  }
                }
              },
              catch: (e) => (e instanceof AgentError ? e : new AgentError('LLM_FAILED', String(e))),
            })
          );
          if (Either.isLeft(streamed)) {
            yield* turn.transition(sid, { kind: 'fail', error: toFrameError(streamed.left) });
            yield* emitTurnEnd('error');
            return Result.err(streamed.left);
          }

          yield* turn.transition(sid, { kind: 'running', responded });

          const reasoning = reasoningText
            ? {
                displayText: reasoningText,
                provider: reasoningProvider || 'unknown',
                replayData: { kind: 'full_text' as const, value: reasoningText },
                ...(responded.usage?.reasoningTokens !== undefined
                  ? { reasoningTokens: responded.usage.reasoningTokens }
                  : {}),
              }
            : undefined;

          if (toolCalls.length === 0) {
            if (content.trim() === '' && !abortSignal?.aborted) {
              const detail =
                drainedCount > 0 ? ` after delivering ${drainedCount} subagent result(s)` : '';
              const emptyErr = new AgentError(
                'EMPTY_RESPONSE',
                `model returned an empty response${detail}`
              );
              yield* turn.transition(sid, { kind: 'fail', error: toFrameError(emptyErr) });
              yield* emitTurnEnd('error');
              yield* flushMemoryInBackground(sessionKey, model);
              return Result.err(emptyErr);
            }

            const assistantEv = yield* session.recordAssistant(state, {
              content,
              toolCalls: [],
              usage: responded.usage,
              reasoning,
            });
            yield* context.absorb(sessionRef, [assistantEv]);
            const stopDecision = yield* hooks.emitDecision(HOOK_POINT.AGENT_TURN_STOP, {
              sessionId: sid,
              content,
              turnId: state.currentTurnId,
              projectPath,
            });

            if (stopDecision && stopDecision.decision === 'continue') {
              if (stopContinuations >= maxStopContinuations) {
                const loopErr = new AgentError(
                  'AGENT_LOOP_DETECTED',
                  'max stop continuations exceeded'
                );
                yield* turn.transition(sid, { kind: 'fail', error: toFrameError(loopErr) });
                yield* emitTurnEnd('error');
                yield* flushMemoryInBackground(sessionKey, model);
                return Result.err(loopErr);
              }
              stopContinuations++;
              const injection = stopDecision.injection ?? '(continue)';
              const systemEv = yield* session.recordSystem(state, [textPart(injection)]);
              yield* context.absorb(sessionRef, [systemEv]);
              continue;
            }

            if ((yield* absorbPendingInputs()) > 0) continue;

            yield* turn.transition(sid, { kind: 'complete', reason: 'done' });
            lastResult = Result.ok(content);
            yield* emitTurnEnd('done');
            break;
          }

          const assistantToolEv = yield* session.recordAssistant(state, {
            content,
            toolCalls,
            usage: responded.usage,
            reasoning,
          });
          yield* context.absorb(sessionRef, [assistantToolEv]);

          const execCtx: ToolBatchContext = {
            session: sessionRef,
            agentName: state.agentName,
            signal: abortSignal,
            permissionMode,
            sandbox,
            model,
          };
          const preparedBatch = yield* executor.prepareBatch({
            toolCalls,
            context: execCtx,
            toolLookup,
          });
          const escalationDecisions = yield* approval.evaluateEscalationBatch(
            preparedBatch.escalations.map(({ request }) => request)
          );
          const escalatedCalls = preparedBatch.escalations
            .filter((_, index) => escalationDecisions[index]?.type === 'allow')
            .map(({ prepared }) => prepared);
          const decisions = yield* approval.evaluateBatch(
            preparedBatch.prepared.map((prepared) => ({
              prepared,
              session: sessionKey,
              permissionMode,
            }))
          );
          const approvedCalls = [
            ...preparedBatch.prepared.filter((_, index) => decisions[index]?.type === 'allow'),
            ...escalatedCalls,
          ];
          const deniedResults: ToolResult[] = [
            ...preparedBatch.denied,
            ...preparedBatch.prepared.flatMap((prepared, index) => {
              const decision = decisions[index];
              return decision?.type === 'deny'
                ? [
                    {
                      status: 'denied' as const,
                      id: prepared.call.id,
                      name: prepared.call.name,
                      reason: decision.reason,
                    },
                  ]
                : [];
            }),
            ...preparedBatch.escalations.flatMap(({ prepared }, index) => {
              const decision = escalationDecisions[index];
              return decision?.type === 'deny'
                ? [
                    {
                      status: 'denied' as const,
                      id: prepared.call.id,
                      name: prepared.call.name,
                      reason: decision.reason,
                    },
                  ]
                : [];
            }),
          ];

          if (approvedCalls.length > 0 && !state.parentSessionId) {
            yield* checkpoint.ensureBaseline({
              target: sessionKey,
              turnId: state.currentTurnId,
            });
          }

          const approvedResults =
            approvedCalls.length > 0
              ? yield* executor.executeBatch({ toolCalls: approvedCalls, context: execCtx })
              : [];

          const resultsById = new Map<string, ToolResult>();
          for (const r of approvedResults) resultsById.set(r.id, r);
          for (const r of deniedResults) resultsById.set(r.id, r);
          const allResults = toolCalls
            .map((tc) => resultsById.get(tc.id))
            .filter((r): r is ToolResult => r !== undefined);
          const argsById = new Map(toolCalls.map((tc) => [tc.id, tc.arguments] as const));

          for (const r of allResults) {
            const output = r.status === 'denied' ? '' : r.output;
            const toolEv = yield* session.recordToolResult(state, {
              toolCallId: r.id,
              toolName: r.name,
              output,
            });
            yield* context.absorb(sessionRef, [toolEv]);
            const outcome = toolOutcomeOf(r);
            const todos =
              r.status === 'ok' && r.name === 'todo_write'
                ? (argsById.get(r.id)?.plan as TodoItem[] | undefined)
                : undefined;
            emit({
              family: 'event',
              event: {
                type: 'tool_result',
                id: r.id,
                name: r.name,
                outcome,
                ...(todos ? { todos } : {}),
              },
            });
          }
        }

        if (lastResult) return lastResult;

        const maxErr = AgentError.maxStepsReached(maxSteps);
        yield* turn.transition(sid, { kind: 'complete', reason: 'maxSteps' });
        yield* emitTurnEnd('maxSteps');
        return Result.err(maxErr);
      }).pipe(
        Effect.interruptible,
        Effect.onInterrupt(() =>
          Effect.gen(function* () {
            yield* turn.transition(sid, { kind: 'interrupt' });
            yield* emitTurnEnd('aborted').pipe(Effect.ignore);
          })
        ),
        Effect.ensuring(
          Effect.gen(function* () {
            yield* turn
              .transition(sid, {
                kind: 'fail',
                error: { message: 'agent terminated without end frame', code: 'AGENT_TERMINATED' },
              })
              .pipe(Effect.ignore);
            yield* flushMemoryInBackground(sessionKey, model);
          })
        )
      );
    }

    return { runTurn };
  })
);
