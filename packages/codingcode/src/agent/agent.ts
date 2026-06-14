import { Effect, Queue, Stream, Fiber } from 'effect';
import { z } from 'zod';
import type { Message } from '../core/types.js';
import { AgentError } from '../core/error.js';
import { Result } from '../core/result.js';
import type { ToolDescription, ToolDefinition } from '../tools/types.js';
import type { LLMClient } from '../llm/client.js';
import { ToolExecutorService, type ToolLookup } from '../tools/executor.js';
import { SessionService } from '../session/store.js';
import { CheckpointService } from '../checkpoint/checkpoint-service.js';
import { ApprovalService } from '../approval/index.js';
import { ApprovalWaitService } from '../approval/async-confirm.js';
import { buildSystemPrompt } from './prompt.js';
import type { AgentEvent, RunStreamOptions } from './types.js';
import { resolveConfig } from './config.js';
import { getContextConfig } from '../context/config.js';
import { TodoService } from './todo.js';
import { HookService } from '../hooks/registry.js';
import { SkillService } from '../skills/service.js';
import { McpService } from '../mcp/index.js';
import { ContextService } from '../context/service.js';
import { MemoryService } from '../memory/index.js';
import { createLogger } from '@codingcode/infra/logger';
import { resolveSubagentEnabled, resolveAgentDisabled } from '../subagent/registry.js';
import { ProjectRuntimeService } from '../runtime/project-runtime.js';
import { createDispatchAgentTool } from '../tools/domains/subagent/dispatch.js';
import { LLMFactoryService } from '../llm/factory.js';
import { getBuiltinTools } from '../tools/providers.js';
import { canonicalizeSchema } from '../tools/utils/canonicalize-schema.js';
import { normalizePath } from '../core/path.js';
import { RulesService } from '../rules/index.js';

const logger = createLogger();

export class AgentService extends Effect.Service<AgentService>()('Agent', {
  effect: Effect.gen(function* () {
    const executor = yield* ToolExecutorService;
    const hooks = yield* HookService;
    const approval = yield* ApprovalService;
    const approvalWait = yield* ApprovalWaitService;
    const session = yield* SessionService;
    const checkpoint = yield* CheckpointService;
    const runtime = yield* ProjectRuntimeService;
    const todo = yield* TodoService;
    const context = yield* ContextService;
    const memory = yield* MemoryService;
    const { maxSteps, maxStopContinuations } = resolveConfig();

    const runStream = (
      opts: RunStreamOptions
    ): AsyncGenerator<AgentEvent, Result<string, AgentError>, unknown> => {
      const q = Effect.runSync(Queue.unbounded<AgentEvent>());

      const program = Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              hooks.disposeSession(opts.state.sessionId);
            })
          );
          return yield* agentLoop(executor, hooks, maxSteps, maxStopContinuations, opts, q);
        }).pipe(
          Effect.provideService(HookService, hooks),
          Effect.provideService(ToolExecutorService, executor),
          Effect.provideService(ApprovalService, approval),
          Effect.provideService(ApprovalWaitService, approvalWait),
          Effect.provideService(SessionService, session),
          Effect.provideService(CheckpointService, checkpoint),
          Effect.provideService(ProjectRuntimeService, runtime),
          Effect.provideService(TodoService, todo),
          Effect.provideService(ContextService, context),
          Effect.provideService(MemoryService, memory)
        )
      );

      return (async function* () {
        const fiber = Effect.runFork(program);

        if (opts.abortSignal) {
          opts.abortSignal.addEventListener(
            'abort',
            () => {
              Effect.runFork(Fiber.interrupt(fiber));
            },
            { once: true }
          );
          if (opts.abortSignal.aborted) {
            Effect.runFork(Fiber.interrupt(fiber));
          }
        }

        const stream = Stream.fromQueue(q).pipe(Stream.interruptWhen(Fiber.await(fiber)));

        for await (const event of Stream.toAsyncIterable(stream) as AsyncIterable<AgentEvent>) {
          yield event;
        }

        try {
          const result = await Effect.runPromise(Fiber.join(fiber));
          return result;
        } catch (e) {
          return Result.err(
            e instanceof AgentError ? e : new AgentError('AGENT_ABORTED' as any, String(e))
          );
        }
      })();
    };

    return { runStream };
  }),
}) {}

export const sendMessage = (
  sessionId: string | undefined,
  input: string,
  cwd: string,
  llm: LLMClient,
  options?: {
    signal?: AbortSignal;
    approvalOverride?: any;
  }
) =>
  Effect.gen(function* () {
    const session = yield* SessionService;
    const agent = yield* AgentService;
    const hooks = yield* HookService;
    const mcp = yield* McpService;
    const checkpoint = yield* CheckpointService;
    const approval = yield* ApprovalService;
    const skills = yield* SkillService;
    const runtime = yield* ProjectRuntimeService;
    const todo = yield* TodoService;
    const rules = yield* RulesService;
    const context = yield* ContextService;
    const memory = yield* MemoryService;
    const factory = yield* LLMFactoryService;

    const normalizedCwd = normalizePath(cwd);
    yield* runtime.prepareProject(normalizedCwd);
    yield* skills.evictProject(normalizedCwd);

    const state = yield* session.create(normalizedCwd, llm.modelInfo.model, sessionId);
    state.memorySnapshot = memory.loadMemoryForPrompt(state.cwd);
    const sid = state.sessionId;

    const profile = runtime.resolveMainAgentProfile(normalizedCwd, state.sessionId);
    const policy = runtime.getToolPolicy(profile);

    const dispatchTool = yield* createDispatchAgentTool();

    let activeLlm = llm;
    if (profile?.model) {
      const entry = yield* factory.findModel(profile.model);
      if (entry) {
        activeLlm = yield* factory.createClient(entry);
      }
    }
    const effectiveMaxSteps = profile?.maxSteps;
    const effectiveApproval: any = profile?.readonly
      ? { permissionMode: 'bypass' }
      : options?.approvalOverride;

    if (profile?.hooks?.length) {
      yield* hooks.attachSessionHooks(sid, profile.hooks);
    }

    if (profile?.mcpServers?.length) {
      yield* mcp.connectServers(normalizedCwd, sid, profile.mcpServers);
    }

    const mcpTools = mcp.listProjectMcpTools(normalizedCwd);

    const turnId = session.incrementTurn(state);
    const [matchedSkill, actualInput] = yield* skills.extractSkill(state.cwd, input);

    yield* session.recordUser(state, actualInput);

    const turnTitle = actualInput.trim().slice(0, 5) || '(empty)';
    yield* checkpoint.snapshotBaseline(state.cwd, sid, turnId, turnTitle);

    const rulesText = rules.getAllRules(state.cwd);

    const stream = agent.runStream({
      state,
      llm: activeLlm,
      toolPolicy: policy,
      maxStepsOverride: effectiveMaxSteps,
      approvalOverride: effectiveApproval,
      dispatchTool,
      mcpTools,
      skillInstruction: matchedSkill?.instruction,
      abortSignal: options?.signal,
      rulesText,
    });

    return { stream, sessionId: sid };
  });

export function agentLoop(
  executor: ToolExecutorService,
  hooks: HookService,
  maxSteps: number,
  maxStopContinuations: number,
  opts: RunStreamOptions,
  q: Queue.Queue<AgentEvent>
): Effect.Effect<
  Result<string, AgentError>,
  AgentError,
  | HookService
  | ToolExecutorService
  | CheckpointService
  | SessionService
  | ProjectRuntimeService
  | TodoService
  | ContextService
  | MemoryService
> {
  const state = opts.state;
  const llm = opts.llm;
  const sessionId = state.sessionId;
  const projectPath = state.cwd;

  return Effect.gen(function* () {
    const checkpoint = yield* CheckpointService;
    const session = yield* SessionService;
    const runtime = yield* ProjectRuntimeService;
    const todo = yield* TodoService;
    const context = yield* ContextService;
    const memory = yield* MemoryService;
    const { skillInstruction, systemPromptVariant, rulesText } = opts;

    const allAgentProfiles = runtime.listAgentProfiles(projectPath);
    const agentProfiles = resolveSubagentEnabled(projectPath)
      ? allAgentProfiles.filter((p) => !resolveAgentDisabled(projectPath, p.name))
      : [];
    const basePrompt =
      opts.systemOverride ??
      buildSystemPrompt({
        cwd: projectPath,
        platform: process.platform,
        shell: process.env.SHELL || process.env.ComSpec || 'bash',
        variant: systemPromptVariant ?? 'default',
        skillInstruction,
        agentProfiles,
        rules: rulesText,
      });

    const memoryBlock = state.memorySnapshot;
    const memorySection = memoryBlock ? `## Session Memory\n\n${memoryBlock}` : '';
    const system = [basePrompt, memorySection].filter(Boolean).join('\n\n');

    const config = getContextConfig();
    const maxOverflowRetries = config.reactiveCompactMaxRetries;
    const model = state.sessionMeta?.model ?? 'unknown';
    const effectiveMaxSteps = opts.maxStepsOverride ?? maxSteps;

    let stopContinuations = 0;
    const effectiveMaxStopContinuations = opts.maxStopContinuations ?? maxStopContinuations;

    for (let attempt = 0; attempt <= maxOverflowRetries; attempt++) {
      const { messages } = yield* Effect.sync(() =>
        context.assemblePayload(state.sessionId, state.projectPath, config, llm.modelInfo.maxTokens)
      );

      let lastResult: Result<string, AgentError> | null = null;
      let overflow = false;

      yield* hooks.emit('agent.turn.start', { sessionId });

      yield* q.offer({ _tag: 'TurnId', turnId: state.currentTurnId });

      for (let step = 0; step < effectiveMaxSteps; step++) {
        yield* q.offer({ _tag: 'Step', step: step + 1, max: effectiveMaxSteps });

        const builtinTools = yield* getBuiltinTools();
        let allToolDefs: ToolDefinition[] = [...builtinTools, ...(opts.mcpTools ?? [])];
        if (opts.dispatchTool && resolveSubagentEnabled(projectPath))
          allToolDefs = [...allToolDefs, opts.dispatchTool];

        const allowedByPolicy = opts.toolPolicy?.allowedTools;
        let filteredDefs = allToolDefs;
        if (allowedByPolicy) filteredDefs = filteredDefs.filter((t) => allowedByPolicy.has(t.name));

        const tools: ToolDescription[] = filteredDefs.map((t) => ({
          name: t.name,
          description: t.description,
          parameters:
            t.jsonSchema ??
            (canonicalizeSchema(z.toJSONSchema(t.parameters)) as Record<string, unknown>),
        }));

        const toolLookup: ToolLookup = (name: string) => filteredDefs.find((t) => t.name === name);
        const systemWithCatalog = system;

        const stepBeforePayload = { sessionId, step: step + 1 };
        yield* hooks.emitDecision('agent.step.before', stepBeforePayload);

        const compressResult = yield* Effect.tryPromise({
          try: () =>
            context.compactIfNeeded(
              state.sessionId,
              state.projectPath,
              messages,
              llm.modelInfo.maxTokens,
              config,
              llm
            ),
          catch: (e) => new AgentError('LLM_FAILED', String(e)),
        });
        if (compressResult.didCompress) {
          yield* q.offer({
            _tag: 'ReactiveCompact',
            attempt: 1,
            released: compressResult.released,
            promptEstimate: compressResult.promptEstimate,
          });

          const rebuilt = yield* Effect.sync(() =>
            context.assemblePayload(
              state.sessionId,
              state.projectPath,
              config,
              llm.modelInfo.maxTokens
            )
          );
          messages.length = 0;
          messages.push(...rebuilt.messages);
          state.usage = undefined;
          state.promptEstimate = rebuilt.promptEstimate;
        }

        const llmMessages = [...messages];

        const { stream: rawStream, response: respPromise } = llm.completeStream(
          {
            messages: llmMessages,
            system: systemWithCatalog,
            tools,
            maxSteps: 1,
          },
          opts.abortSignal
        );

        yield* Effect.tryPromise({
          try: async () => {
            for await (const chunk of rawStream) {
              if (opts.abortSignal?.aborted) break;
              Effect.runSync(q.offer({ _tag: 'LlmChunk', text: chunk }));
            }
          },
          catch: (e) => new AgentError('LLM_FAILED', String(e)),
        });

        const llmResult = yield* Effect.tryPromise({
          try: () => respPromise,
          catch: (e) => new AgentError('LLM_FAILED', String(e)),
        });
        if (!llmResult.ok) {
          if (llmResult.error.code === 'CONTEXT_OVERFLOW' && attempt < maxOverflowRetries) {
            const compressResult = yield* Effect.tryPromise({
              try: () =>
                context.compactWithLLM(
                  state.sessionId,
                  state.projectPath,
                  config,
                  null,
                  undefined,
                  undefined,
                  undefined,
                  llm.modelInfo.maxTokens
                ),
              catch: (e) => new AgentError('LLM_FAILED', String(e)),
            });
            yield* q.offer({
              _tag: 'ReactiveCompact',
              attempt: attempt + 1,
              released: compressResult.released,
              promptEstimate: compressResult.promptEstimate,
            });
            overflow = true;
            break;
          }
          yield* q.offer({ _tag: 'Error', error: llmResult.error });
          lastResult = Result.err(llmResult.error);
          yield* hooks.emit('agent.turn.end', {
            sessionId,
            turnId: state.currentTurnId,
            status: 'error',
          });
          break;
        }

        const resp = llmResult.value;
        const toolCalls = resp.toolCalls;
        const assistantMsg: Message = { role: 'assistant', content: resp.content };
        if (toolCalls && toolCalls.length > 0) {
          assistantMsg.tool_calls = toolCalls;
        }
        messages.push(assistantMsg);
        yield* q.offer({ _tag: 'Assistant', content: resp.content, toolCalls });
        if (resp.usage) {
          yield* q.offer({
            _tag: 'Usage',
            prompt: resp.usage.prompt,
            completion: resp.usage.completion,
            total: resp.usage.total,
          });
        }

        if (!toolCalls || toolCalls.length === 0) {
          if (session) {
            yield* session.recordAssistant(state, resp.content, toolCalls || [], model, resp.usage);
          }
          const stopDecision = yield* hooks.emitDecision('agent.turn.stop', {
            sessionId,
            content: resp.content,
            turnId: state.currentTurnId,
          });

          if (stopDecision && stopDecision.decision === 'continue') {
            if (stopContinuations >= effectiveMaxStopContinuations) {
              yield* q.offer({
                _tag: 'Error',
                error: new AgentError('AGENT_LOOP_DETECTED', 'max stop continuations exceeded'),
              });
              yield* hooks.emit('agent.turn.end', {
                sessionId,
                turnId: state.currentTurnId,
                status: 'error',
              });
              memory
                .flushSessionToMemory(state.sessionId, llm)
                .catch((e) => logger.error('memory flush failed:', e));
              return Result.err(
                new AgentError('AGENT_LOOP_DETECTED', 'max stop continuations exceeded')
              );
            }
            stopContinuations++;
            const injection = stopDecision.injection ?? '(continue)';
            if (session) {
              yield* session.recordUser(state, injection);
            }
            messages.push({ role: 'user', content: injection });
            continue;
          }

          yield* q.offer({ _tag: 'Done', content: resp.content });
          lastResult = Result.ok(resp.content);
          yield* hooks.emit('agent.turn.end', {
            sessionId,
            turnId: state.currentTurnId,
            status: 'done',
          });
          break;
        }

        if (toolCalls) {
          for (const tc of toolCalls) {
            yield* q.offer({
              _tag: 'ToolStart',
              id: tc.id,
              name: tc.name,
              args: tc.arguments ?? {},
            });
          }
        }

        const record = yield* session.recordAssistant(
          state,
          resp.content,
          toolCalls!,
          model,
          resp.usage
        );
        const allResults = yield* executor.executeBatch(toolCalls, state.sessionId, {
          turnId: state.currentTurnId,
          projectPath,
          signal: opts.abortSignal,
          approval: opts.approvalOverride,
          toolLookup,
        });

        let todoPrinted = false;
        for (const r of allResults) {
          const resultOut = r.type === 'denied' ? '' : r.output;
          yield* session.recordToolResult(state, record.uuid, r.name, r.id, resultOut);
          if (r.type === 'denied') {
            yield* q.offer({ _tag: 'ToolDenied', id: r.id, name: r.name, reason: r.reason });
          } else {
            const isOk = r.type === 'ok';
            yield* q.offer({ _tag: 'ToolResult', id: r.id, name: r.name, output: resultOut, ok: isOk });
          }
          if (!messages.find((m) => m.tool_call_id === r.id)) {
            const content =
              r.type === 'denied'
                ? `[Denied] Tool "${r.name}" was denied: ${r.reason}`
                : (r.output ?? '');
            messages.push({ role: 'tool', content, tool_call_id: r.id, tool_name: r.name });
          }
          if (!todoPrinted && r.name === 'todo_write') {
            yield* q.offer({ _tag: 'TodoUpdate', items: todo.read(sessionId) });
            todoPrinted = true;
          }
        }
      }

      if (overflow) continue;

      yield* checkpoint.snapshotFinal(projectPath, state.sessionId, state.currentTurnId);

      memory
        .flushSessionToMemory(state.sessionId, llm)
        .catch((e) => logger.error('memory flush failed:', e));

      if (lastResult) return lastResult;

      yield* q.offer({ _tag: 'Error', error: AgentError.maxStepsReached(effectiveMaxSteps) });
      yield* hooks.emit('agent.turn.end', {
        sessionId,
        turnId: state.currentTurnId,
        status: 'maxSteps',
      });
      return Result.err(AgentError.maxStepsReached(effectiveMaxSteps));
    }

    yield* q.offer({ _tag: 'Error', error: AgentError.maxStepsReached(effectiveMaxSteps) });
    yield* hooks.emit('agent.turn.end', {
      sessionId,
      turnId: state.currentTurnId,
      status: 'maxSteps',
    });
    memory
      .flushSessionToMemory(state.sessionId, llm)
      .catch((e) => logger.error('memory flush failed:', e));
    return Result.err(AgentError.maxStepsReached(effectiveMaxSteps));
  }).pipe(
    Effect.interruptible,
    Effect.onInterrupt(() =>
      Effect.sync(() => {
        Effect.runSync(
          q.offer({ _tag: 'Error', error: new AgentError('AGENT_ABORTED', 'cancelled') })
        );
        hooks
          .emit('agent.turn.end', {
            sessionId,
            turnId: state.currentTurnId,
            status: 'aborted',
          })
          .pipe(Effect.runPromise)
          .catch(() => {});
      })
    ),
    Effect.ensuring(
      Effect.gen(function* () {
        const cp = yield* CheckpointService;
        yield* cp.snapshotFinal(projectPath, sessionId, state.currentTurnId).pipe(Effect.ignore);
        const mem = yield* MemoryService;
        mem
          .flushSessionToMemory(state.sessionId, llm)
          .catch((e) => logger.error('memory flush failed:', e));
      })
    )
  );
}
