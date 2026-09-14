import { Effect, Either, Queue, Stream, Fiber, Layer } from 'effect';
import { AgentError } from '../core/error.js';
import { Result } from '../core/result.js';
import { AgentService } from './port.js';
import type { RunTurnOptions } from './port.js';
import {
  SessionPort, ToolExecutorPort, CheckpointPort, HookPort,
  ApprovalPort, SkillPort, McpPort, ContextPort, MemoryPort,
  LlmPort, RulesPort, TodoPort, ToolEnvPort, ToolCatalogPort,
} from './deps.js';
import type { ToolEnv, ToolCatalog } from './deps.js';
import { buildSystemPrompt } from './prompt.js';
import type { FrameBody, FrameError, ResponseMeta, ToolOutcome, Transition } from '../contracts/frame.js';
import { isTurnEnd } from '../contracts/frame.js';
import type { ToolResult } from '../contracts/tool.js';
import type { ToolCall } from '../contracts/types.js';
import { loadConfig } from '@codingcode/infra/config';
import { createLogger } from '@codingcode/infra/logger';
import { normalizePath, computePaths } from '../core/path.js';
import { resolveProfile, getToolNames } from './profile.js';

function toolOutcomeOf(result: ToolResult): ToolOutcome {
  return result.status === 'denied'
    ? { status: 'denied', reason: result.reason }
    : { status: result.status, output: result.output };
}
import type { AgentProfile } from './profile.js';
import type { PermissionMode } from '../contracts/permission.js';

const logger = createLogger();

function toFrameError(e: AgentError): FrameError {
  return { message: e.message, code: e.code };
}

export const AgentLayer = Layer.effect(AgentService, Effect.gen(function* () {
  const session = yield* SessionPort;
  const executor = yield* ToolExecutorPort;
  const checkpoint = yield* CheckpointPort;
  const hooks = yield* HookPort;
  const approval = yield* ApprovalPort;
  const skills = yield* SkillPort;
  const mcp = yield* McpPort;
  const context = yield* ContextPort;
  const memory = yield* MemoryPort;
  const llmFactory = yield* LlmPort;
  const rules = yield* RulesPort;
  const todo = yield* TodoPort;
  const toolEnvPort = yield* ToolEnvPort;
  const toolCatalog = yield* ToolCatalogPort;
  const cfg = loadConfig();
  const maxSteps = cfg.maxSteps ?? 250;
  const maxStopContinuations = cfg.maxStopContinuations ?? 3;

  const runTurn = (input: string, opts: RunTurnOptions) =>
    Effect.gen(function* () {
      const normalizedCwd = normalizePath(opts.cwd);

      rules.evictProjectRules(normalizedCwd);
      yield* hooks.emit('agent.turn.start', { sessionId: '' }).pipe(Effect.catchAll(() => Effect.void));
      yield* mcp.syncConnections(normalizedCwd).pipe(Effect.catchAll(() => Effect.void));

      let sessionId = opts.sessionId;
      const llm = yield* llmFactory.getLLMClient();
      if (!sessionId) {
        if (!opts.activeProfile || !opts.permissionMode) {
          return yield* Effect.fail(
            new AgentError('CONFIG_MISSING', 'new session requires activeProfile and permissionMode')
          );
        }
        const model = opts.model ?? llm.modelInfo.model;
        const created = yield* session.create(normalizedCwd, {
          model,
          activeProfile: opts.activeProfile,
          permissionMode: opts.permissionMode,
        });
        sessionId = created.sessionId;
      }

      const state = yield* session.load(normalizedCwd, sessionId);

      // restore session profile/permission from the frontend request, falling back to persisted values
      const profileName = opts.activeProfile ?? state.activeProfile;
      const effectivePerm = opts.permissionMode ?? state.permissionMode;
      if (opts.permissionMode) {
        yield* session.setPermissionMode(normalizedCwd, sessionId, opts.permissionMode);
      }
      if (opts.activeProfile) {
        yield* session.setActiveProfile(normalizedCwd, sessionId, opts.activeProfile);
      }

      state.memorySnapshot = memory.loadMemoryForPrompt(state.cwd);

      const profile: AgentProfile | undefined = profileName ? resolveProfile(profileName) : undefined;

      const catalog = yield* toolCatalog.register(getToolNames(profile), normalizedCwd);

      const toolEnv = yield* toolEnvPort.getToolEnv();

      // record user (increments turn) + extract skill
      const [, actualInput] = yield* skills.extractSkill(state.cwd, input);
      const turnId = yield* session.recordUser(state, actualInput);

      // checkpoint baseline
      yield* checkpoint.snapshotBaseline(state.cwd, sessionId, turnId);

      // get rules text
      const rulesText = rules.getAllRules(state.cwd);

      // run agent loop
      const stream = runAgentLoop({
        state, llm, profile, catalog,
        toolEnv,
        abortSignal: opts.signal, rulesText,
        sid: sessionId, projectPath: state.cwd, permissionMode: effectivePerm,
      });

      return { stream, sessionId };
    });

  function runAgentLoop(opts: {
    state: any; llm: any; profile: AgentProfile | undefined;
    abortSignal: AbortSignal | undefined;
    catalog: ToolCatalog;
    toolEnv: ToolEnv;
    rulesText: string;
    sid: string; projectPath: string; permissionMode: PermissionMode;
  }): AsyncGenerator<FrameBody> {
    const q = Effect.runSync(Queue.unbounded<FrameBody>());

    const program: any = Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => { hooks.disposeSession(opts.sid); })
        );
        return yield* agentLoopInternal(opts, q);
      }).pipe(
        Effect.provideService(SessionPort, session),
        Effect.provideService(ToolExecutorPort, executor),
        Effect.provideService(CheckpointPort, checkpoint),
        Effect.provideService(HookPort, hooks),
        Effect.provideService(ApprovalPort, approval),
        Effect.provideService(SkillPort, skills),
        Effect.provideService(McpPort, mcp),
        Effect.provideService(ContextPort, context),
        Effect.provideService(MemoryPort, memory),
        Effect.provideService(LlmPort, llmFactory),
        Effect.provideService(RulesPort, rules),
        Effect.provideService(TodoPort, todo),
      )
    );

    return (async function* () {
      const fiber = Effect.runFork(opts.toolEnv.provide(program));
      if (opts.abortSignal) {
        opts.abortSignal.addEventListener('abort', () => {
          Effect.runFork(Fiber.interrupt(fiber));
        }, { once: true });
        if (opts.abortSignal.aborted) Effect.runFork(Fiber.interrupt(fiber));
      }

      const stream = Stream.fromQueue(q).pipe(
        Stream.takeUntil((body: FrameBody) => isTurnEnd(body))
      );
      for await (const body of Stream.toAsyncIterable(stream) as AsyncIterable<FrameBody>) {
        yield body;
      }
    })();
  }

  function agentLoopInternal(opts: {
    state: any; llm: any; profile: AgentProfile | undefined;
    abortSignal: AbortSignal | undefined;
    catalog: ToolCatalog;
    rulesText: string;
    sid: string; projectPath: string; permissionMode: PermissionMode;
  }, q: Queue.Queue<FrameBody>): any {
    const { state, llm, profile, abortSignal, catalog, rulesText, sid, projectPath, permissionMode } = opts;
    const { tools, lookup: toolLookup } = catalog;

    let ended = false;
    const offerEnd = (transition: Extract<Transition, { to: 'end' }>) =>
      Effect.sync(() => {
        if (ended) return;
        ended = true;
        Effect.runSync(q.offer({ family: 'transition', transition }));
      });

    return Effect.gen(function* () {
      const basePrompt = buildSystemPrompt({
        cwd: projectPath,
        platform: process.platform,
        shell: process.env.SHELL || process.env.ComSpec || 'bash',
        rules: rulesText,
        profileSystemPrompt: profile?.systemPrompt,
      });

      const memoryBlock = state.memorySnapshot;
      const memorySection = memoryBlock ? `## Session Memory\n\n${memoryBlock}` : '';
      const system = [basePrompt, memorySection].filter(Boolean).join('\n\n');

      let stopContinuations = 0;
      const effectiveMaxStopContinuations = maxStopContinuations;

      let lastResult: Result<string, AgentError> | null = null;

      yield* hooks.emit('agent.turn.start', { sessionId: sid });
      yield* q.offer({ family: 'transition', transition: { to: 'start', turnId: state.currentTurnId } });

      for (let step = 0; step < maxSteps; step++) {
        yield* hooks.emitDecision('agent.step.before', { sessionId: sid, step: step + 1 });

        if (step === 0) {
          yield* q.offer({ family: 'transition', transition: { to: 'executing' } });
        }

        const transcriptPath = computePaths(state.cwd, state.sessionId, state.parentSessionId).transcriptPath;

        const willCompact = yield* Effect.either(Effect.tryPromise({
          try: () => context.willCompact(transcriptPath, llm.modelInfo.maxTokens),
          catch: (e) => new AgentError('LLM_FAILED', String(e)),
        }));
        if (Either.isLeft(willCompact)) {
          yield* offerEnd({ to: 'end', reason: 'error', error: toFrameError(willCompact.left) });
          yield* hooks.emit('agent.turn.end', { sessionId: sid, turnId: state.currentTurnId, status: 'error' });
          return Result.err(willCompact.left);
        }
        if (willCompact.right) {
          yield* q.offer({ family: 'transition', transition: { to: 'compress' } });
        }

        const assembled = yield* Effect.either(Effect.tryPromise({
          try: () => context.assemblePayload(transcriptPath, llm.modelInfo.maxTokens, llm),
          catch: (e) => new AgentError('LLM_FAILED', String(e)),
        }));
        if (Either.isLeft(assembled)) {
          yield* offerEnd({ to: 'end', reason: 'error', error: toFrameError(assembled.left) });
          yield* hooks.emit('agent.turn.end', { sessionId: sid, turnId: state.currentTurnId, status: 'error' });
          return Result.err(assembled.left);
        }
        if (willCompact.right) {
          yield* q.offer({ family: 'transition', transition: { to: 'executing' } });
        }

        const llmMessages = [...assembled.right];

        let content = '';
        const toolCalls: ToolCall[] = [];
        let responded: ResponseMeta = {};

        const streamed = yield* Effect.either(Effect.tryPromise({
          try: async () => {
            for await (const part of llm.completeStream({ messages: llmMessages, system, tools, maxSteps: 1 }, abortSignal)) {
              if (abortSignal?.aborted) break;
              if (part.type === 'text') {
                content += part.text;
                Effect.runSync(q.offer({ family: 'event', event: { type: 'text_delta', text: part.text } }));
              } else if (part.type === 'tool_call') {
                toolCalls.push({ id: part.id, name: part.name, arguments: part.args });
                Effect.runSync(q.offer({
                  family: 'event',
                  event: { type: 'tool_call', id: part.id, name: part.name, args: part.args },
                }));
              } else {
                responded = part.usage ? { usage: part.usage } : {};
                Effect.runSync(q.offer({
                  family: 'transition',
                  transition: { to: 'executing', responded },
                }));
              }
            }
          },
          catch: (e) => (e instanceof AgentError ? e : new AgentError('LLM_FAILED', String(e))),
        }));
        if (Either.isLeft(streamed)) {
          yield* offerEnd({ to: 'end', reason: 'error', error: toFrameError(streamed.left) });
          yield* hooks.emit('agent.turn.end', { sessionId: sid, turnId: state.currentTurnId, status: 'error' });
          return Result.err(streamed.left);
        }

        if (toolCalls.length === 0) {
          yield* session.recordAssistant(state, content, [], responded.usage);
          const stopDecision = yield* hooks.emitDecision('agent.turn.stop', { sessionId: sid, content, turnId: state.currentTurnId });

          if (stopDecision && stopDecision.decision === 'continue') {
            if (stopContinuations >= effectiveMaxStopContinuations) {
              const loopErr = new AgentError('AGENT_LOOP_DETECTED', 'max stop continuations exceeded');
              yield* offerEnd({ to: 'end', reason: 'error', error: toFrameError(loopErr) });
              yield* hooks.emit('agent.turn.end', { sessionId: sid, turnId: state.currentTurnId, status: 'error' });
              memory.flushSessionToMemory(state.sessionId, llm, state.cwd).catch((e) => logger.error('memory flush failed:', e));
              return Result.err(loopErr);
            }
            stopContinuations++;
            const injection = stopDecision.injection ?? '(continue)';
            yield* session.recordSystem(state, injection);
            continue;
          }

          yield* offerEnd({ to: 'end', reason: 'done' });
          lastResult = Result.ok(content);
          yield* hooks.emit('agent.turn.end', { sessionId: sid, turnId: state.currentTurnId, status: 'done' });
          break;
        }

        yield* session.recordAssistant(state, content, toolCalls, responded.usage);

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
            deniedResults.push({ status: 'denied', id: tc.id, name: tc.name, reason: decision.reason });
          } else {
            approvedCalls.push(tc);
          }
        }

        const approvedResults = approvedCalls.length > 0
          ? yield* executor.executeBatch(approvedCalls, state.sessionId, {
              turnId: state.currentTurnId, projectPath, signal: abortSignal, toolLookup,
            })
          : [];

        const allResults = [...approvedResults, ...deniedResults];

        let todoPrinted = false;
        for (const r of allResults) {
          const resultOut = r.status === 'denied' ? '' : r.output;
          yield* session.recordToolResult(state, r.name, r.id, resultOut);
          const outcome = toolOutcomeOf(r);
          const todos = !todoPrinted && r.status === 'ok' && r.name === 'todo_write'
            ? todo.read(sid)
            : undefined;
          if (todos) todoPrinted = true;
          yield* q.offer({
            family: 'event',
            event: {
              type: 'tool_result', id: r.id, name: r.name, outcome,
              ...(todos ? { todos } : {}),
            },
          });
        }
      }

      yield* checkpoint.snapshotFinal(projectPath, state.sessionId, state.currentTurnId);
      memory.flushSessionToMemory(state.sessionId, llm, state.cwd).catch((e) => logger.error('memory flush failed:', e));

      if (lastResult) return lastResult;

      const maxErr = AgentError.maxStepsReached(maxSteps);
      yield* offerEnd({ to: 'end', reason: 'maxSteps' });
      yield* hooks.emit('agent.turn.end', { sessionId: sid, turnId: state.currentTurnId, status: 'maxSteps' });
      return Result.err(maxErr);
    }).pipe(
      Effect.interruptible,
      Effect.onInterrupt(() =>
        Effect.gen(function* () {
          yield* offerEnd({ to: 'end', reason: 'aborted' });
          yield* hooks.emit('agent.turn.end', { sessionId: opts.sid, turnId: opts.state.currentTurnId, status: 'aborted' }).pipe(Effect.ignore);
        })
      ),
      Effect.ensuring(
        Effect.gen(function* () {
          yield* offerEnd({
            to: 'end',
            reason: 'error',
            error: { message: 'agent terminated without end frame', code: 'AGENT_TERMINATED' },
          });
          yield* checkpoint.snapshotFinal(opts.projectPath, opts.sid, opts.state.currentTurnId).pipe(Effect.ignore);
          memory.flushSessionToMemory(opts.state.sessionId, opts.llm, opts.projectPath).catch((e) => logger.error('memory flush failed:', e));
        })
      )
    );
  }

  return { runTurn };
} as any));
