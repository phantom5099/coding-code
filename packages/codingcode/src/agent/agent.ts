import { Effect, Either, Stream, Fiber, Layer } from 'effect';
import { AgentError } from '../util/error.js';
import { Result } from '../util/result.js';
import { AgentService, ToolEnvPort } from './port.js';
import type { RunTurnOptions } from './port.js';
import { ApprovalService, getToolNames } from '../approval/port.js';
import { CheckpointService } from '../checkpoint/port.js';
import { ContextService } from '../context/port.js';
import { EventSinkService } from '../sink/port.js';
import { TurnRegistryService } from '../turn/port.js';
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
  FrameBody,
  FrameError,
  ResponseMeta,
  ToolOutcome,
} from '../sink/types.js';
import { isTurnEnd } from '../sink/types.js';
import type { SessionRef } from '../session/types.js';
import type { PermissionMode } from '../util/enums.js';
import type { ToolCatalog, ToolResult } from '../tools/types.js';
import { mediaKindOf, textOf, textPart, type IncomingPart } from '../llm/types.js';
import type { ToolCall } from '../llm/types.js';
import { capabilitiesOf } from '../infra/models.js';
import { sniffMediaMime } from '../util/media.js';
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

    // capabilitiesOf 是同步查询，抛出的 AgentError 原样进错误通道
    const caps = yield* Effect.try({
      try: () => capabilitiesOf(model),
      catch: (e) => (e instanceof AgentError ? e : AgentError.invalidInput(String(e))),
    });
    if (needsVision && !caps.vision) {
      return yield* Effect.fail(AgentError.invalidInput('model does not accept image or PDF input'));
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

    const runTurn = (input: IncomingPart[], opts: RunTurnOptions) =>
      Effect.gen(function* () {
        const normalizedCwd = normalizePath(opts.cwd);

        // 提交判定：命中活跃回合 → 输入进状态表，直接返回，不开回合
        if (opts.sessionId) {
          const verdict = yield* turn.submit(opts.sessionId, { id: opts.inputId!, parts: input });
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
              title: textOf(input) || 'New session',
              activeProfile: opts.activeProfile,
              permissionMode: opts.permissionMode,
            },
            { parentSessionId, agentName: opts.agentName }
          );
          sessionId = created.sessionId;
          parentSessionId = created.parentSessionId;
        }

        const state = yield* session.load(normalizedCwd, sessionId, parentSessionId);
        const sid: string = sessionId;
        const turnId = state.currentTurnId + 1;

        // 先于任何落盘：409 的 loser 不写 transcript、不建 checkpoint
        if (
          !(yield* turn.claim(sid, {
            turnId,
            parentSessionId: state.parentSessionId,
            agentName: state.agentName,
          }))
        ) {
          return yield* Effect.fail(new AgentError('TURN_CONFLICT', 'concurrent turn on session'));
        }

        return yield* Effect.gen(function* () {
          const profileName = opts.activeProfile ?? state.activeProfile;
          const effectivePerm = opts.permissionMode ?? state.permissionMode;
          if (opts.permissionMode) {
            yield* session.setPermissionMode(normalizedCwd, sid, opts.permissionMode, parentSessionId);
          }
          if (opts.activeProfile) {
            yield* session.setActiveProfile(normalizedCwd, sid, opts.activeProfile, parentSessionId);
          }

          state.memorySnapshot = yield* memory.loadMemoryForPrompt(state.cwd);

          const profile: AgentProfile | undefined = profileName
            ? resolveProfile(profileName)
            : undefined;

          const mcpTools = yield* mcp.listProjectMcpTools(normalizedCwd);
          const catalog = yield* executor.prepare(getToolNames(profileName), mcpTools);

          const toolEnv = yield* toolEnvPort.getToolEnv();

          yield* assertMediaAllowed(input, model);
          const parts = yield* session.materializeInput(state, input);
          yield* session.recordUser(state, parts);

          // 用户显式 @ 的 skill：按 path 回查权威数据，正文拼块后作为同回合的第二条 user 事件
          if (opts.skills?.length) {
            const all = yield* skills.getAll(state.cwd);
            const chosen = all.filter((s) => opts.skills!.some((m) => m.path === s.skillPath));
            if (chosen.length) {
              const entries = yield* Effect.forEach(chosen, (s) =>
                skills.readContent(s.skillPath).pipe(Effect.map((body) => ({ skill: s, body })))
              );
              yield* session.recordSystem(state, [textPart(renderSkillBlock(entries))]);
            }
          }

          // checkpoint baseline
          yield* checkpoint.snapshotBaseline(state.cwd, sid, turnId);

          const rulesText = yield* rules.getAllRules(state.cwd);

          // 出站队列挂在 sink 上，本回合是它的唯一读者
          const q = yield* sink.attach(sid);
          const emit = (body: FrameBody) => Effect.runSync(sink.emit(sid, body));

          // 出生帧须在 attach 之后
          yield* turn.transition(sid, { kind: 'start' });

          // 回合出生：eager 段的最后一句
          const program = agentLoopInternal(
            {
              state,
              model,
              profile,
              catalog,
              rulesText,
              abortSignal: opts.signal,
              sid,
              projectPath: state.cwd,
              permissionMode: effectivePerm,
              systemPrompt: opts.systemPrompt,
            },
            emit
          );
          const fiber = Effect.runFork(toolEnv.provide(program));
          if (opts.signal) {
            opts.signal.addEventListener('abort', () => Effect.runFork(Fiber.interrupt(fiber)), {
              once: true,
            });
            if (opts.signal.aborted) Effect.runFork(Fiber.interrupt(fiber));
          }
          yield* turn.arm(sid, () => Effect.runFork(Fiber.interrupt(fiber)));

          // 搬帧器：只搬帧，不负责启动回合
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
          // 出生前失败 → 落 error 终态（settle 幂等）
          Effect.onError((cause) =>
            turn
              .transition(sid, {
                kind: 'fail',
                error: toFrameError(cause as unknown as AgentError),
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
      const { tools, lookup: toolLookup } = catalog;

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

        const sessionRef: SessionRef = {
          cwd: state.cwd,
          sessionId: state.sessionId,
          parentSessionId: state.parentSessionId,
          currentTurnId: state.currentTurnId,
        };

        /** 吸收本回合待投递的 steer 输入；返回条数 */
        const absorbPendingInputs = () =>
          Effect.gen(function* () {
            let n = 0;
            // steer 输入先于子代理结果，否则"用户指令"会排在"子代理汇报"之后
            for (const ui of yield* turn.drain(sid)) {
              // 与首输入同一条准入：不合法即抛错，整批输入随该 step 失败
              yield* assertMediaAllowed(ui.parts, model);
              const stored = yield* session.materializeInput(state, ui.parts);

              const ev = yield* session.recordUserInput(state, stored);
              yield* context.absorb(sessionRef, [ev]);
              emit({ family: 'event', event: { type: 'user_input', id: ui.id, parts: stored } });
              n++;
            }
            return n;
          });

        yield* hooks.emit('agent.turn.start', { sessionId: sid, projectPath });
        // 出生帧已在 eager 段投过，这里不再重复

        for (let step = 0; step < maxSteps; step++) {
          yield* hooks.emitDecision('agent.step.before', {
            sessionId: sid,
            step: step + 1,
            projectPath,
          });

          if (step === 0) {
            yield* turn.transition(sid, { kind: 'running' });
          }

          let drainedCount = yield* absorbPendingInputs();

          if (step > 0) {
            for (const item of yield* mailbox.drain(state.sessionId)) {
              const ev = yield* session.recordSubagentResult(state, item);
              yield* context.absorb(sessionRef, [ev]);
              drainedCount++;
            }
          }

          const history = yield* Effect.either(context.getHistory(sessionRef, model));
          if (Either.isLeft(history)) {
            yield* turn.transition(sid, {
              kind: 'fail',
              error: toFrameError(history.left),
            });
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
                  {
                    messages: llmMessages,
                    system,
                    tools,
                    maxSteps: 1,
                  },
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
                  }
                }
              },
              catch: (e) => (e instanceof AgentError ? e : new AgentError('LLM_FAILED', String(e))),
            })
          );
          if (Either.isLeft(streamed)) {
            yield* turn.transition(sid, { kind: 'fail', error: toFrameError(streamed.left) });
            yield* hooks.emit('agent.turn.end', {
              sessionId: sid,
              turnId: state.currentTurnId,
              status: 'error',
              projectPath,
            });
            return Result.err(streamed.left);
          }

          // 流结束帧（携带 usage）：在流外统一投递
          yield* turn.transition(sid, { kind: 'running', responded });

          if (toolCalls.length === 0) {
            if (content.trim() === '' && !abortSignal?.aborted) {
              const detail =
                drainedCount > 0 ? ` after delivering ${drainedCount} subagent result(s)` : '';
              const emptyErr = new AgentError(
                'EMPTY_RESPONSE',
                `model returned an empty response${detail}`
              );
              yield* turn.transition(sid, { kind: 'fail', error: toFrameError(emptyErr) });
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
                yield* turn.transition(sid, { kind: 'fail', error: toFrameError(loopErr) });
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
              const systemEv = yield* session.recordSystem(state, [textPart(injection)]);
              yield* context.absorb(sessionRef, [systemEv]);
              continue;
            }

            // 终稿后有 steer 输入 → 吸收进上下文并续跑，turnId 不变、不重发 start 帧
            if ((yield* absorbPendingInputs()) > 0) continue;

            yield* turn.transition(sid, { kind: 'complete', reason: 'done' });
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
              ? yield* executor.executeBatch(
                  approvedCalls,
                  state.sessionId,
                  {
                    turnId: state.currentTurnId,
                    projectPath,
                    signal: abortSignal,
                    activeProfile: profile?.name,
                    model,
                  },
                  toolLookup
                )
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
        yield* turn.transition(sid, { kind: 'complete', reason: 'maxSteps' });
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
            yield* turn.transition(sid, { kind: 'interrupt' });
            yield* hooks
              .emit('agent.turn.end', {
                sessionId: sid,
                turnId: state.currentTurnId,
                status: 'aborted',
                projectPath,
              })
              .pipe(Effect.ignore);
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
            yield* checkpoint
              .snapshotFinal(state.cwd, sid, state.currentTurnId)
              .pipe(Effect.ignore);
            yield* flushMemoryInBackground(state.sessionId, model, state.cwd);
          })
        )
      );
    }

    return { runTurn };
  })
);
