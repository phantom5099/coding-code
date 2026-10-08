import { Effect, Either, Queue, Stream, Fiber, Layer } from 'effect';
import { AgentError } from '../util/error.js';
import { Result } from '../util/result.js';
import { AgentService, ToolEnvPort } from './port.js';
import type { RunTurnOptions, ToolEnv } from './port.js';
import { ApprovalService, getToolNames } from '../approval/port.js';
import { CheckpointService } from '../checkpoint/port.js';
import { ContextService } from '../context/port.js';
import { EventSinkService } from '../sink/port.js';
import { MailboxService } from '../session/mailbox.js';
import { HookService } from '../hooks/port.js';
import { LLMService } from '../llm/port.js';
import { McpService } from '../mcp/port.js';
import { MemoryService } from '../memory/port.js';
import { RulesService } from '../rules/port.js';
import { SessionService } from '../session/port.js';
import { SkillService } from '../skills/port.js';
import { TodoService } from '../todo/port.js';
import { ToolExecutorService } from '../tools/port.js';
import { buildSystemPrompt, renderSkillBlock } from './prompt.js';
import type {
  EndTransition,
  FrameBody,
  FrameError,
  ResponseMeta,
  ToolOutcome,
} from '../sink/types.js';
import { isTurnEnd } from '../sink/types.js';
import type { SessionRef } from '../session/types.js';
import type { PermissionMode } from '../session/types.js';
import type { ToolCatalog, ToolResult } from '../tools/types.js';
import type { ToolCall } from '../llm/types.js';
import { loadConfig } from '../infra/config.js';
import { createLogger } from '../infra/logger.js';
import { normalizePath } from '../util/path.js';
import { resolveProfile } from './profile.js';
import type { AgentProfile } from './profile.js';

function toolOutcomeOf(result: ToolResult): ToolOutcome {
  return result.status === 'denied'
    ? { status: 'denied', reason: result.reason }
    : { status: result.status, output: result.output };
}

const logger = createLogger();

function toFrameError(e: AgentError): FrameError {
  return { message: e.message, code: e.code };
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
    const mailbox = yield* MailboxService;
    const memory = yield* MemoryService;
    const llm = yield* LLMService;
    const rules = yield* RulesService;
    const todo = yield* TodoService;
    const toolEnvPort = yield* ToolEnvPort;
    const cfg = loadConfig();
    const maxSteps = cfg.maxSteps ?? 250;
    const maxStopContinuations = cfg.maxStopContinuations ?? 3;

    const flushMemoryInBackground = (sessionId: string, model: string, cwd: string) =>
      Effect.forkDaemon(
        memory
          .flushSessionToMemory(sessionId, model, cwd)
          .pipe(
            Effect.catchAllCause((cause) =>
              Effect.sync(() => logger.error('memory flush failed:', cause))
            )
          )
      );

    const runTurn = (input: string, opts: RunTurnOptions) =>
      Effect.gen(function* () {
        const normalizedCwd = normalizePath(opts.cwd);

        yield* rules.evictProjectRules(normalizedCwd);
        yield* hooks.reloadUserHooks(normalizedCwd);
        yield* hooks.emit('agent.turn.start', { sessionId: '', projectPath: normalizedCwd });
        yield* mcp.syncConnections(normalizedCwd);

        let sessionId = opts.sessionId;
        let parentSessionId = opts.parentSessionId;
        const model = opts.model;
        if (!sessionId) {
          if (!opts.activeProfile || !opts.permissionMode) {
            return yield* Effect.fail(
              new AgentError(
                'CONFIG_MISSING',
                'new session requires activeProfile and permissionMode'
              )
            );
          }
          const created = yield* session.create(
            normalizedCwd,
            {
              model,
              title: input,
              activeProfile: opts.activeProfile,
              permissionMode: opts.permissionMode,
            },
            { parentSessionId, agentName: opts.agentName }
          );
          sessionId = created.sessionId;
          parentSessionId = created.parentSessionId;
        }

        const state = yield* session.load(normalizedCwd, sessionId, parentSessionId);

        const profileName = opts.activeProfile ?? state.activeProfile;
        const effectivePerm = opts.permissionMode ?? state.permissionMode;
        if (opts.permissionMode) {
          yield* session.setPermissionMode(
            normalizedCwd,
            sessionId,
            opts.permissionMode,
            parentSessionId
          );
        }
        if (opts.activeProfile) {
          yield* session.setActiveProfile(
            normalizedCwd,
            sessionId,
            opts.activeProfile,
            parentSessionId
          );
        }

        state.memorySnapshot = yield* memory.loadMemoryForPrompt(state.cwd);

        const profile: AgentProfile | undefined = profileName
          ? resolveProfile(profileName)
          : undefined;

        const mcpTools = yield* mcp.listProjectMcpTools(normalizedCwd);
        const catalog = yield* executor.prepare(getToolNames(profileName), mcpTools);

        const toolEnv = yield* toolEnvPort.getToolEnv();

        const turnId = (yield* session.recordUser(state, input)).turnId;

        // 用户显式 @ 的 skill：按 path 回查权威数据，正文拼块后作为同回合的第二条 user 事件
        if (opts.skills?.length) {
          const all = yield* skills.getAll(state.cwd);
          const chosen = all.filter((s) => opts.skills!.some((m) => m.path === s.skillPath));
          if (chosen.length) {
            const entries = yield* Effect.forEach(chosen, (s) =>
              skills.readContent(s.skillPath).pipe(Effect.map((body) => ({ skill: s, body })))
            );
            yield* session.recordSystem(state, renderSkillBlock(entries));
          }
        }

        // checkpoint baseline
        yield* checkpoint.snapshotBaseline(state.cwd, sessionId, turnId);

        // get rules text
        const rulesText = yield* rules.getAllRules(state.cwd);

        // run agent loop：出站队列挂在 sink 上，本回合是它的唯一读者
        const q = yield* sink.attach(sessionId);
        const emit = (body: FrameBody) => Effect.runSync(sink.emit(sessionId, body));
        const stream = runAgentLoop(
          {
            state,
            model,
            profile,
            catalog,
            systemPrompt: opts.systemPrompt,
            toolEnv,
            abortSignal: opts.signal,
            rulesText,
            sid: sessionId,
            projectPath: state.cwd,
            permissionMode: effectivePerm,
          },
          { q, emit, onEnd: () => Effect.runSync(sink.detach(sessionId)) }
        );

        return { stream, sessionId };
      });

    function runAgentLoop(
      opts: {
        state: any;
        model: string;
        profile: AgentProfile | undefined;
        abortSignal: AbortSignal | undefined;
        catalog: ToolCatalog;
        toolEnv: ToolEnv;
        rulesText: string;
        sid: string;
        projectPath: string;
        permissionMode: PermissionMode;
        systemPrompt?: string;
      },
      out: {
        q: Queue.Queue<FrameBody>;
        emit: (body: FrameBody) => void;
        onEnd: () => void;
      }
    ): AsyncGenerator<FrameBody> {
      const program = agentLoopInternal(opts, out.emit);

      return (async function* () {
        const fiber = Effect.runFork(opts.toolEnv.provide(program));
        if (opts.abortSignal) {
          opts.abortSignal.addEventListener(
            'abort',
            () => {
              Effect.runFork(Fiber.interrupt(fiber));
            },
            { once: true }
          );
          if (opts.abortSignal.aborted) Effect.runFork(Fiber.interrupt(fiber));
        }

        try {
          const stream = Stream.fromQueue(out.q).pipe(
            Stream.takeUntil((body: FrameBody) => isTurnEnd(body))
          );
          for await (const body of Stream.toAsyncIterable(stream) as AsyncIterable<FrameBody>) {
            yield body;
          }
        } finally {
          out.onEnd();
        }
      })();
    }

    function agentLoopInternal(
      opts: {
        state: any;
        model: string;
        profile: AgentProfile | undefined;
        abortSignal: AbortSignal | undefined;
        catalog: ToolCatalog;
        rulesText: string;
        sid: string;
        projectPath: string;
        permissionMode: PermissionMode;
        systemPrompt?: string;
      },
      emit: (body: FrameBody) => void
    ): Effect.Effect<Result<string, AgentError>, AgentError> {
      const {
        state,
        model,
        profile,
        abortSignal,
        catalog,
        rulesText,
        sid,
        projectPath,
        permissionMode,
      } = opts;
      const { tools } = catalog;

      let ended = false;
      let deliveryPhase: 'currentTurn' | 'nextTurn' = 'currentTurn';
      const offerEnd = (transition: EndTransition) =>
        Effect.sync(() => {
          if (ended) return;
          ended = true;
          emit({ family: 'transition', transition });
        });

      return Effect.gen(function* () {
        const basePrompt = buildSystemPrompt({
          cwd: projectPath,
          platform: process.platform,
          shell: process.env.SHELL || process.env.ComSpec || 'bash',
          rules: rulesText,
          profileSystemPrompt: opts.systemPrompt ?? profile?.systemPrompt,
        });

        const memoryBlock = state.memorySnapshot;
        const memorySection = memoryBlock ? `## Session Memory\n\n${memoryBlock}` : '';
        const system = [basePrompt, memorySection].filter(Boolean).join('\n\n');

        let stopContinuations = 0;
        const effectiveMaxStopContinuations = maxStopContinuations;

        let lastResult: Result<string, AgentError> | null = null;

        yield* hooks.emit('agent.turn.start', { sessionId: sid, projectPath });
        emit({ family: 'transition', transition: { to: 'start', turnId: state.currentTurnId } });

        for (let step = 0; step < maxSteps; step++) {
          yield* hooks.emitDecision('agent.step.before', {
            sessionId: sid,
            step: step + 1,
            projectPath,
          });

          if (step === 0) {
            emit({ family: 'transition', transition: { to: 'executing' } });
          }

          const sessionRef: SessionRef = {
            cwd: state.cwd,
            sessionId: state.sessionId,
            parentSessionId: state.parentSessionId,
            currentTurnId: state.currentTurnId,
          };

          const mayDrain = deliveryPhase === 'currentTurn' && step > 0;
          let drainedCount = 0;
          if (mayDrain) {
            for (const item of yield* mailbox.drain(state.sessionId)) {
              const ev = yield* session.recordSubagentResult(state, item);
              yield* context.absorb(sessionRef, [ev]);
              drainedCount++;
            }
          }

          const history = yield* Effect.either(context.getHistory(sessionRef, model));
          if (Either.isLeft(history)) {
            yield* offerEnd({ to: 'end', reason: 'error', error: toFrameError(history.left) });
            yield* hooks.emit('agent.turn.end', {
              sessionId: sid,
              turnId: state.currentTurnId,
              status: 'error',
              projectPath,
            });
            return Result.err(history.left);
          }

          const llmMessages = [...history.right];

          let content = '';
          const toolCalls: ToolCall[] = [];
          let responded: ResponseMeta = {};

          const streamed = yield* Effect.either(
            Effect.tryPromise({
              try: async () => {
                for await (const part of llm.completeStream(
                  { messages: llmMessages, system, tools, maxSteps: 1 },
                  model,
                  abortSignal
                )) {
                  if (abortSignal?.aborted) break;
                  if (part.type === 'text') {
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
                        args: part.arguments,
                      },
                    });
                  } else {
                    responded = part.usage ? { usage: part.usage } : {};
                    emit({
                      family: 'transition',
                      transition: { to: 'executing', responded },
                    });
                  }
                }
              },
              catch: (e) => (e instanceof AgentError ? e : new AgentError('LLM_FAILED', String(e))),
            })
          );
          if (Either.isLeft(streamed)) {
            yield* offerEnd({ to: 'end', reason: 'error', error: toFrameError(streamed.left) });
            yield* hooks.emit('agent.turn.end', {
              sessionId: sid,
              turnId: state.currentTurnId,
              status: 'error',
              projectPath,
            });
            return Result.err(streamed.left);
          }

          if (toolCalls.length === 0) {
            if (content.trim() === '' && !abortSignal?.aborted) {
              const detail =
                drainedCount > 0 ? ` after delivering ${drainedCount} subagent result(s)` : '';
              const emptyErr = new AgentError(
                'EMPTY_RESPONSE',
                `model returned an empty response${detail}`
              );
              yield* offerEnd({ to: 'end', reason: 'error', error: toFrameError(emptyErr) });
              yield* hooks.emit('agent.turn.end', {
                sessionId: sid,
                turnId: state.currentTurnId,
                status: 'error',
                projectPath,
              });
              yield* flushMemoryInBackground(state.sessionId, model, state.cwd);
              return Result.err(emptyErr);
            }

            const assistantEv = yield* session.recordAssistant(state, content, [], responded.usage);
            yield* context.absorb(sessionRef, [assistantEv]);
            deliveryPhase = 'nextTurn';
            const stopDecision = yield* hooks.emitDecision('agent.turn.stop', {
              sessionId: sid,
              content,
              turnId: state.currentTurnId,
              projectPath,
            });

            if (stopDecision && stopDecision.decision === 'continue') {
              if (stopContinuations >= effectiveMaxStopContinuations) {
                const loopErr = new AgentError(
                  'AGENT_LOOP_DETECTED',
                  'max stop continuations exceeded'
                );
                yield* offerEnd({ to: 'end', reason: 'error', error: toFrameError(loopErr) });
                yield* hooks.emit('agent.turn.end', {
                  sessionId: sid,
                  turnId: state.currentTurnId,
                  status: 'error',
                  projectPath,
                });
                yield* flushMemoryInBackground(state.sessionId, model, state.cwd);
                return Result.err(loopErr);
              }
              stopContinuations++;
              const injection = stopDecision.injection ?? '(continue)';
              const systemEv = yield* session.recordSystem(state, injection);
              yield* context.absorb(sessionRef, [systemEv]);
              continue;
            }

            yield* offerEnd({ to: 'end', reason: 'done' });
            lastResult = Result.ok(content);
            yield* hooks.emit('agent.turn.end', {
              sessionId: sid,
              turnId: state.currentTurnId,
              status: 'done',
              projectPath,
            });
            break;
          }

          const assistantToolEv = yield* session.recordAssistant(
            state,
            content,
            toolCalls,
            responded.usage
          );
          yield* context.absorb(sessionRef, [assistantToolEv]);

          const approvedCalls: any[] = [];
          const deniedResults: any[] = [];
          for (const tc of toolCalls) {
            const decision = yield* approval.evaluate({
              tool: tc.name,
              input: tc.arguments ?? {},
              callId: tc.id,
              sessionId: state.sessionId,
              projectPath,
              permissionMode,
              profile: profile?.name,
            });
            if (decision.type === 'deny') {
              deniedResults.push({
                status: 'denied',
                id: tc.id,
                name: tc.name,
                reason: decision.reason,
              });
            } else {
              approvedCalls.push(tc);
            }
          }

          const approvedResults =
            approvedCalls.length > 0
              ? yield* catalog.executeBatch(approvedCalls, state.sessionId, {
                  turnId: state.currentTurnId,
                  projectPath,
                  signal: abortSignal,
                  activeProfile: profile?.name,
                  model,
                })
              : [];

          const resultsById = new Map<string, any>();
          for (const r of approvedResults) resultsById.set(r.id, r);
          for (const r of deniedResults) resultsById.set(r.id, r);
          const allResults = toolCalls.map((tc) => resultsById.get(tc.id));

          let todoPrinted = false;
          for (const r of allResults) {
            const resultOut = r.status === 'denied' ? '' : r.output;
            const toolEv = yield* session.recordToolResult(state, r.name, r.id, resultOut);
            yield* context.absorb(sessionRef, [toolEv]);
            const outcome = toolOutcomeOf(r);
            const todos =
              !todoPrinted && r.status === 'ok' && r.name === 'todo_write'
                ? todo.read(sid)
                : undefined;
            if (todos) todoPrinted = true;
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

        yield* checkpoint.snapshotFinal(projectPath, state.sessionId, state.currentTurnId);
        yield* flushMemoryInBackground(state.sessionId, model, state.cwd);

        if (lastResult) return lastResult;

        const maxErr = AgentError.maxStepsReached(maxSteps);
        yield* offerEnd({ to: 'end', reason: 'maxSteps' });
        yield* hooks.emit('agent.turn.end', {
          sessionId: sid,
          turnId: state.currentTurnId,
          status: 'maxSteps',
          projectPath,
        });
        return Result.err(maxErr);
      }).pipe(
        Effect.interruptible,
        Effect.onInterrupt(() =>
          Effect.gen(function* () {
            yield* offerEnd({ to: 'end', reason: 'aborted' });
            yield* hooks
              .emit('agent.turn.end', {
                sessionId: opts.sid,
                turnId: opts.state.currentTurnId,
                status: 'aborted',
                projectPath: opts.projectPath,
              })
              .pipe(Effect.ignore);
          })
        ),
        Effect.ensuring(
          Effect.gen(function* () {
            yield* offerEnd({
              to: 'end',
              reason: 'error',
              error: { message: 'agent terminated without end frame', code: 'AGENT_TERMINATED' },
            });
            yield* checkpoint
              .snapshotFinal(opts.projectPath, opts.sid, opts.state.currentTurnId)
              .pipe(Effect.ignore);
            yield* flushMemoryInBackground(opts.state.sessionId, opts.model, opts.projectPath);
          })
        )
      );
    }

    return { runTurn };
  })
);
