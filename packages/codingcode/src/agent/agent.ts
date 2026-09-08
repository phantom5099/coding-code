import { Effect, Queue, Stream, Fiber, Layer } from 'effect';
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
import type { AgentEvent } from './types.js';
import { loadConfig } from '@codingcode/infra/config';
import { createLogger } from '@codingcode/infra/logger';
import { normalizePath, computePaths } from '../core/path.js';
import { resolveProfile, getToolNames } from './profile.js';
import type { AgentProfile } from './profile.js';

const logger = createLogger();

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
      const sid = state.sessionId;

      // restoreSessionProfile
      const effectivePerm = opts.permissionMode ?? 'default';
      yield* session.setPermissionMode(normalizedCwd, sid, effectivePerm);
      if (opts.activeProfile) {
        yield* session.setActiveProfile(normalizedCwd, sid, opts.activeProfile);
      }

      state.memorySnapshot = memory.loadMemoryForPrompt(state.cwd);

      // resolveMainAgentProfile
      const profileName = yield* session.getActiveProfile(normalizedCwd, sid);
      const profile: AgentProfile | undefined = profileName ? resolveProfile(profileName) : undefined;

      // get MCP tools
      const mcpTools = mcp.listProjectMcpTools(normalizedCwd);

      // 只把"自己需要的工具名字名单 + MCP 工具"交给工具模块注册，拿到成品描述 + 查找，
      // 装配与名单取舍由组合根（ToolCatalogLayer）按名查表完成，agent 拿到后直接消费、不再查询。
      const catalog = toolCatalog.register(getToolNames(profile), mcpTools);

      // tool execution-time dependencies: resolved via the ToolEnvPort abstraction,
      // so the agent never imports concrete services (mcp/hook/todo/subagent).
      const toolEnv = yield* toolEnvPort.getToolEnv();

      // record user (increments turn) + extract skill
      const [, actualInput] = yield* skills.extractSkill(state.cwd, input);
      const userEvent = yield* session.recordUser(state, actualInput);

      // checkpoint baseline
      yield* checkpoint.snapshotBaseline(state.cwd, sid, userEvent.turnId);

      // get rules text
      const rulesText = rules.getAllRules(state.cwd);

      // run agent loop
      const stream = runAgentLoop({
        state, llm, profile, catalog,
        toolEnv,
        abortSignal: opts.signal, rulesText,
        sid, projectPath: state.cwd,
      });

      return { stream, sessionId: sid };
    });

  function runAgentLoop(opts: {
    state: any; llm: any; profile: AgentProfile | undefined;
    abortSignal: AbortSignal | undefined;
    catalog: ToolCatalog;
    toolEnv: ToolEnv;
    rulesText: string;
    sid: string; projectPath: string;
  }): AsyncGenerator<AgentEvent> {
    const q = Effect.runSync(Queue.unbounded<AgentEvent>());

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
      const stream = Stream.fromQueue(q).pipe(Stream.interruptWhen(Fiber.await(fiber)));
      for await (const event of Stream.toAsyncIterable(stream) as AsyncIterable<AgentEvent>) {
        yield event;
      }
    })();
  }

  function agentLoopInternal(opts: {
    state: any; llm: any; profile: AgentProfile | undefined;
    abortSignal: AbortSignal | undefined;
    catalog: ToolCatalog;
    rulesText: string;
    sid: string; projectPath: string;
  }, q: Queue.Queue<AgentEvent>): any {
    const { state, llm, profile, abortSignal, catalog, rulesText, sid, projectPath } = opts;
    const { tools, lookup: toolLookup } = catalog;

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
      yield* q.offer({ _tag: 'TurnId', turnId: state.currentTurnId });

      for (let step = 0; step < maxSteps; step++) {
        yield* q.offer({ _tag: 'Step', step: step + 1, max: maxSteps });

        yield* hooks.emitDecision('agent.step.before', { sessionId: sid, step: step + 1 });

        const payload = yield* Effect.tryPromise({
          try: () => context.assemblePayload(computePaths(state.cwd, state.sessionId, state.parentSessionId).transcriptPath, llm.modelInfo.maxTokens, llm),
          catch: (e) => new AgentError('LLM_FAILED', String(e)),
        });
        if (payload.compressed) {
          yield* q.offer({
            _tag: 'ContextCompressed',
            released: payload.released,
            promptEstimate: payload.promptEstimate,
          });
        }
        const llmMessages = [...payload.messages];
        const { stream: rawStream, response: respPromise } = llm.completeStream(
          { messages: llmMessages, system, tools, maxSteps: 1 },
          abortSignal
        );

        yield* Effect.tryPromise({
          try: async () => {
            for await (const chunk of rawStream) {
              if (abortSignal?.aborted) break;
              Effect.runSync(q.offer({ _tag: 'LlmChunk', text: chunk }));
            }
          },
          catch: (e) => new AgentError('LLM_FAILED', String(e)),
        });

        const llmResult: any = yield* Effect.tryPromise({
          try: () => respPromise,
          catch: (e) => new AgentError('LLM_FAILED', String(e)),
        });
        if (!llmResult.ok) {
          yield* q.offer({ _tag: 'Error', error: llmResult.error });
          lastResult = Result.err(llmResult.error);
          yield* hooks.emit('agent.turn.end', { sessionId: sid, turnId: state.currentTurnId, status: 'error' });
          break;
        }

        const resp = llmResult.value;
        const toolCalls = resp.toolCalls;
        yield* q.offer({ _tag: 'Assistant', content: resp.content, toolCalls });
        if (resp.usage) {
          yield* q.offer({ _tag: 'Usage', prompt: resp.usage.prompt, completion: resp.usage.completion, total: resp.usage.total });
        }

        if (!toolCalls || toolCalls.length === 0) {
          yield* session.recordAssistant(state, resp.content, toolCalls || [], resp.usage);
          const stopDecision = yield* hooks.emitDecision('agent.turn.stop', { sessionId: sid, content: resp.content, turnId: state.currentTurnId });

          if (stopDecision && stopDecision.decision === 'continue') {
            if (stopContinuations >= effectiveMaxStopContinuations) {
              yield* q.offer({ _tag: 'Error', error: new AgentError('AGENT_LOOP_DETECTED', 'max stop continuations exceeded') });
              yield* hooks.emit('agent.turn.end', { sessionId: sid, turnId: state.currentTurnId, status: 'error' });
              memory.flushSessionToMemory(state.sessionId, llm, state.cwd).catch((e) => logger.error('memory flush failed:', e));
              return Result.err(new AgentError('AGENT_LOOP_DETECTED', 'max stop continuations exceeded'));
            }
            stopContinuations++;
            const injection = stopDecision.injection ?? '(continue)';
            yield* session.recordSystem(state, injection);
            continue;
          }

          yield* q.offer({ _tag: 'Done', content: resp.content });
          lastResult = Result.ok(resp.content);
          yield* hooks.emit('agent.turn.end', { sessionId: sid, turnId: state.currentTurnId, status: 'done' });
          break;
        }

        for (const tc of toolCalls as any[]) {
          yield* q.offer({ _tag: 'ToolStart', id: tc.id, name: tc.name, args: tc.arguments ?? {} });
        }

        yield* session.recordAssistant(state, resp.content, toolCalls!, resp.usage);
        const allResults = yield* executor.executeBatch(toolCalls, state.sessionId, {
          turnId: state.currentTurnId, projectPath, signal: abortSignal, toolLookup,
        });

        let todoPrinted = false;
        for (const r of allResults) {
          const resultOut = r.type === 'denied' ? '' : r.output;
          yield* session.recordToolResult(state, r.name, r.id, resultOut);
          if (r.type === 'denied') {
            yield* q.offer({ _tag: 'ToolDenied', id: r.id, name: r.name, reason: r.reason });
          } else {
            yield* q.offer({ _tag: 'ToolResult', id: r.id, name: r.name, output: resultOut, ok: r.type === 'ok' });
          }
          if (!todoPrinted && r.name === 'todo_write') {
            yield* q.offer({ _tag: 'TodoUpdate', items: todo.read(sid) as any });
            todoPrinted = true;
          }
        }
      }

      yield* checkpoint.snapshotFinal(projectPath, state.sessionId, state.currentTurnId);
      memory.flushSessionToMemory(state.sessionId, llm, state.cwd).catch((e) => logger.error('memory flush failed:', e));

      if (lastResult) return lastResult;

      yield* q.offer({ _tag: 'Error', error: AgentError.maxStepsReached(maxSteps) });
      yield* hooks.emit('agent.turn.end', { sessionId: sid, turnId: state.currentTurnId, status: 'maxSteps' });
      return Result.err(AgentError.maxStepsReached(maxSteps));
    }).pipe(
      Effect.interruptible,
      Effect.onInterrupt(() =>
        Effect.gen(function* () {
          yield* Effect.sync(() => {
            Effect.runSync(q.offer({ _tag: 'Error', error: new AgentError('AGENT_ABORTED', 'cancelled') }));
          });
          yield* hooks.emit('agent.turn.end', { sessionId: opts.sid, turnId: opts.state.currentTurnId, status: 'aborted' }).pipe(Effect.ignore);
        })
      ),
      Effect.ensuring(
        Effect.gen(function* () {
          yield* checkpoint.snapshotFinal(opts.projectPath, opts.sid, opts.state.currentTurnId).pipe(Effect.ignore);
          memory.flushSessionToMemory(opts.state.sessionId, opts.llm, opts.projectPath).catch((e) => logger.error('memory flush failed:', e));
        })
      )
    );
  }

  return { runTurn };
} as any));
