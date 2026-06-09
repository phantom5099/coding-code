import { Effect } from 'effect';
import { z } from 'zod';
import { appendFileSync } from 'fs';
import type { Message, ToolCall } from '../core/types.js';
import { AgentError } from '../core/error.js';
import { Result } from '../core/result.js';
import type { ToolDescription, ToolDefinition } from '../tools/types.js';
import type { LLMClient } from '../llm/client.js';
import { ToolExecutorService, type ToolLookup } from '../tools/executor.js';
import { ContextService } from '../context/context.js';
import { SessionService, type SessionStoreState } from '../session/store.js';
import { CheckpointService } from '../checkpoint/checkpoint-service.js';
import { ApprovalService } from '../approval/index.js';
import { buildSystemPrompt, type SystemPromptVariant } from './prompt.js';
import { resolveConfig } from './config.js';
import { getContextConfig } from '../context/config.js';
import { sharedTodoStore } from './todo.js';
import { HookService } from '../hooks/registry.js';
import { SkillService } from '../skills/index.js';
import { McpService } from '../mcp/index.js';
import { loadMemoryForPrompt, flushSessionToMemory } from '../memory/index.js';
import { createLogger } from '@codingcode/infra';
import type { AgentProfile } from '../subagent/registry';
import { resolveSubagentEnabled, resolveAgentDisabled } from '../subagent/registry.js';
import type { ToolVisibilityPolicy } from '../tools/types';
import { ProjectRuntimeService } from '../runtime/project-runtime';
import { createDispatchAgentTool } from '../tools/domains/subagent/dispatch.js';
import { findModel, createClient } from '../llm/factory.js';
import { STATIC_BUILTIN_TOOLS } from '../tools/providers.js';
import { canonicalizeSchema } from '../tools/utils/canonicalize-schema.js';
import { normalizePath } from '../core/path.js';

const logger = createLogger();

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
    const skill = yield* SkillService;
    const hooks = yield* HookService;
    const mcp = yield* McpService;
    const checkpoint = yield* CheckpointService;
    const approval = yield* ApprovalService;

    const runtime = yield* ProjectRuntimeService;
    const normalizedCwd = normalizePath(cwd);
    yield* runtime.prepareProject(normalizedCwd);
    yield* skill.evictProject(normalizedCwd);

    const state = yield* session.create(normalizedCwd, llm.modelInfo.model, sessionId);
    const sid = state.sessionId;

    const profile = runtime.resolveMainAgentProfile(normalizedCwd, state.sessionId);
    const policy = runtime.getToolPolicy(profile);

    const dispatchTool = createDispatchAgentTool({
      session,
      approval,
      hooks,
      runtime,
      mcp,
    });

    // Apply main agent profile: model override, maxSteps, readonly, hooks, MCP
    let activeLlm = llm;
    if (profile?.model) {
      const entry = findModel(profile.model);
      if (entry) {
        const clientResult = yield* Effect.promise(() => createClient(entry));
        if (clientResult.ok) activeLlm = clientResult.value;
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

    // Get MCP tools for injection into ReAct loop
    const mcpTools = mcp.listProjectMcpTools(normalizedCwd);

    const turnId = session.incrementTurn(state);
    const [matchedSkill, actualInput] = yield* skill.extractSkill(state.cwd, input);

    yield* session.recordUser(state, actualInput);

    const turnTitle = actualInput.trim().slice(0, 5) || '(empty)';
    checkpoint.snapshotBaseline(state.cwd, sid, turnId, turnTitle);

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
    });

    return { stream, sessionId: sid };
  });

export type AgentEvent =
  | { readonly _tag: 'LlmChunk'; readonly text: string }
  | { readonly _tag: 'Assistant'; readonly content: string; readonly toolCalls?: ToolCall[] }
  | {
      readonly _tag: 'ToolStart';
      readonly id: string;
      readonly name: string;
      readonly args: Record<string, unknown>;
    }
  | {
      readonly _tag: 'ToolDenied';
      readonly id: string;
      readonly name: string;
      readonly reason: string;
    }
  | {
      readonly _tag: 'ApprovalRequest';
      readonly id: string;
      readonly tool: string;
      readonly args: Record<string, unknown>;
    }
  | {
      readonly _tag: 'ToolResult';
      readonly id: string;
      readonly name: string;
      readonly output: string;
      readonly ok: boolean;
    }
  | { readonly _tag: 'Step'; readonly step: number; readonly max: number }
  | {
      readonly _tag: 'ReactiveCompact';
      readonly attempt: number;
      readonly released: number;
      readonly promptEstimate: number;
    }
  | { readonly _tag: 'Error'; readonly error: AgentError }
  | { readonly _tag: 'Done'; readonly content: string }
  | {
      readonly _tag: 'TodoUpdate';
      readonly items: ReadonlyArray<{
        readonly step: string;
        readonly status: 'pending' | 'in_progress' | 'completed';
      }>;
    }
  | { readonly _tag: 'TurnId'; readonly turnId: number }
  | {
      readonly _tag: 'Usage';
      readonly prompt: number;
      readonly completion: number;
      readonly total: number;
    };

export interface RunStreamOptions {
  state: SessionStoreState;
  llm: LLMClient;
  skillInstruction?: string;
  systemPromptVariant?: SystemPromptVariant;
  systemOverride?: string;
  coreAllowlist?: ReadonlySet<string>;
  toolPolicy?: ToolVisibilityPolicy;
  dispatchTool?: ToolDefinition;
  mcpTools?: ToolDefinition[];
  abortSignal?: AbortSignal;
  parentSessionId?: string;
  agentName?: string;
  maxStepsOverride?: number;
  maxStopContinuations?: number;
  approvalOverride?: any;
}

interface RunReActDeps {
  maxSteps: number;
  maxStopContinuations: number;
  executor: ToolExecutorService;
  runtime: ProjectRuntimeService;
  agentService: {
    runStream: (
      opts: RunStreamOptions
    ) => AsyncGenerator<AgentEvent, Result<string, AgentError>, unknown>;
  };
  ctx: ContextService;
  session: SessionService;
  checkpoint: CheckpointService;
  hooks: HookService;
}

export class AgentService extends Effect.Service<AgentService>()('Agent', {
  effect: Effect.gen(function* () {
    const executor = yield* ToolExecutorService;
    const runtime = yield* ProjectRuntimeService;
    const ctx = yield* ContextService;
    const session = yield* SessionService;
    const checkpoint = yield* CheckpointService;
    const hooks = yield* HookService;
    const { maxSteps, maxStopContinuations } = resolveConfig();

    const service: {
      runStream: (
        opts: RunStreamOptions
      ) => AsyncGenerator<AgentEvent, Result<string, AgentError>, unknown>;
    } = {
      runStream: (opts: RunStreamOptions) =>
        runReActLoop(opts, {
          maxSteps,
          maxStopContinuations,
          executor,
          runtime,
          agentService: service,
          ctx,
          session,
          checkpoint,
          hooks,
        }),
    };

    return service;
  }),
}) {}

export async function* runReActLoop(
  opts: RunStreamOptions,
  deps: RunReActDeps
): AsyncGenerator<AgentEvent, Result<string, AgentError>, unknown> {
  const { state, llm, skillInstruction, systemPromptVariant } = opts;
  const sessionId = state.sessionId;
  const projectPath = state.cwd;

  // Build system prompt — filter agent profiles by global switch and per-agent disabled state
  const allAgentProfiles = deps.runtime.listAgentProfiles(projectPath);
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
    });

  const memoryBlock = state.memorySnapshot;
  const memorySection = memoryBlock
    ? `## Session Memory\n\n${memoryBlock}`
    : '';
  const system = [basePrompt, memorySection].filter(Boolean).join('\n\n');

  const config = getContextConfig();
  const maxOverflowRetries = config.reactiveCompactMaxRetries;
  const model = state.sessionMeta?.model ?? 'unknown';
  const maxSteps = opts.maxStepsOverride ?? deps.maxSteps;

  const { executor, ctx, session, checkpoint, hooks } = deps;

  // For stop hook continue logic
  let stopContinuations = 0;
  const maxStopContinuations = opts.maxStopContinuations ?? deps.maxStopContinuations;

  for (let attempt = 0; attempt <= maxOverflowRetries; attempt++) {
    const { messages } = Effect.runSync(
      ctx.build(state.sessionId, state.projectPath, llm.modelInfo.maxTokens)
    );

    // Inject memory reminder if memory has been updated since session start
    const currentMemory = loadMemoryForPrompt(projectPath);
    if (currentMemory && currentMemory !== state.memorySnapshot) {
      const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
      if (lastUserMsg) {
        lastUserMsg.content += `\n\n<system-reminder>Memory has been updated since the session started. Current memory:\n${currentMemory}</system-reminder>`;
      }
    }

    let lastResult: Result<string, AgentError> | null = null;
    let overflow = false;

    // Emit turn.start hook
    await Effect.runPromise(hooks.emit('agent.turn.start', { sessionId }));

    // Yield turn ID so the client can sync its turn ID with the server
    yield { _tag: 'TurnId', turnId: state.currentTurnId };

    for (let step = 0; step < maxSteps; step++) {
      yield { _tag: 'Step', step: step + 1, max: maxSteps };

      // Check abort signal
      if (opts.abortSignal?.aborted) {
        yield { _tag: 'Error', error: new AgentError('AGENT_ABORTED', 'cancelled') };
        await Effect.runPromise(
          hooks.emit('agent.turn.end', {
            sessionId,
            turnId: state.currentTurnId,
            status: 'aborted',
          })
        );
        flushSessionToMemory(state.sessionId, llm).catch((e) =>
          logger.error('memory flush failed:', e)
        );
        return Result.err(new AgentError('AGENT_ABORTED', 'cancelled'));
      }

      // Build tools from static builtin + MCP + dispatch
      let allToolDefs: ToolDefinition[] = [...STATIC_BUILTIN_TOOLS, ...(opts.mcpTools ?? [])];
      if (opts.dispatchTool && resolveSubagentEnabled(projectPath))
        allToolDefs = [...allToolDefs, opts.dispatchTool];

      // Apply policy filter (derived from AgentProfile.tools via getToolPolicy)
      const allowedByPolicy = opts.toolPolicy?.allowedTools;
      let filteredDefs = allToolDefs;
      if (allowedByPolicy) filteredDefs = filteredDefs.filter((t) => allowedByPolicy.has(t.name));

      // Convert to ToolDescription for LLM
      const tools: ToolDescription[] = filteredDefs.map((t) => ({
        name: t.name,
        description: t.description,
        parameters:
          t.jsonSchema ??
          (canonicalizeSchema(z.toJSONSchema(t.parameters)) as Record<string, unknown>),
      }));

      // Build toolLookup for executor
      const toolLookup: ToolLookup = (name: string) => filteredDefs.find((t) => t.name === name);
      const systemWithCatalog = system;

      // Emit step.before hook and collect transient messages
      const stepBeforePayload = { sessionId, step: step + 1 };
      await Effect.runPromise(hooks.emitDecision('agent.step.before', stepBeforePayload));

      // Threshold-triggered LLM compaction
      const compressResult = await Effect.runPromise(
        ctx.compactIfNeeded(
          state.sessionId,
          state.projectPath,
          llm,
          messages,
          llm.modelInfo.maxTokens,
          config
        )
      );
      if (compressResult.didCompress) {
        yield {
          _tag: 'ReactiveCompact',
          attempt: 1,
          released: compressResult.released,
          promptEstimate: compressResult.promptEstimate,
        };

        const rebuilt = Effect.runSync(
          ctx.build(state.sessionId, state.projectPath, llm.modelInfo.maxTokens)
        );
        messages.length = 0;
        messages.push(...rebuilt.messages);
        state.usage = undefined;
        state.promptEstimate = rebuilt.promptEstimate;
      }

      // Build LLM messages: original messages + step.before transients
      const llmMessages = [...messages];

      // Add step.before transient messages (if any)
      // Note: transient messages are not persisted to JSONL

      const { stream: rawStream, response: respPromise } = llm.completeStream(
        {
          messages: llmMessages,
          system: systemWithCatalog,
          tools,
          maxSteps: 1,
        },
        opts.abortSignal
      );

      for await (const chunk of rawStream) {
        if (opts.abortSignal?.aborted) break;
        yield { _tag: 'LlmChunk', text: chunk };
      }

      const llmResult = await respPromise;
      if (!llmResult.ok) {
        if (llmResult.error.code === 'CONTEXT_OVERFLOW' && attempt < maxOverflowRetries) {
          const compressResult = await Effect.runPromise(
            ctx.compress(
              state.sessionId,
              state.projectPath,
              null,
              undefined,
              llm.modelInfo.maxTokens,
              config
            )
          );
          yield {
            _tag: 'ReactiveCompact',
            attempt: attempt + 1,
            released: compressResult.released,
            promptEstimate: compressResult.promptEstimate,
          };
          overflow = true;
          break;
        }
        yield { _tag: 'Error', error: llmResult.error };
        lastResult = Result.err(llmResult.error);
        await Effect.runPromise(
          hooks.emit('agent.turn.end', {
            sessionId,
            turnId: state.currentTurnId,
            status: 'error',
          })
        );
        break;
      }

      const resp = llmResult.value;
      const toolCalls = resp.toolCalls;
      const assistantMsg: Message = { role: 'assistant', content: resp.content };
      if (toolCalls && toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls;
      }
      messages.push(assistantMsg);
      yield { _tag: 'Assistant', content: resp.content, toolCalls };
      if (resp.usage) {
        yield {
          _tag: 'Usage',
          prompt: resp.usage.prompt,
          completion: resp.usage.completion,
          total: resp.usage.total,
        };
      }

      if (!toolCalls || toolCalls.length === 0) {
        // LLM done — record assistant, then check stop hook
        await Effect.runPromise(
          session.recordAssistant(state, resp.content, toolCalls || [], model, resp.usage)
        );
        const stopDecision = await Effect.runPromise(
          hooks.emitDecision('agent.turn.stop', {
            sessionId,
            content: resp.content,
            turnId: state.currentTurnId,
          })
        );

        if (stopDecision && stopDecision.decision === 'continue') {
          // Continue for another iteration
          if (stopContinuations >= maxStopContinuations) {
            yield {
              _tag: 'Error',
              error: new AgentError('STOP_LOOP', 'max stop continuations exceeded'),
            };
            await Effect.runPromise(
              hooks.emit('agent.turn.end', {
                sessionId,
                turnId: state.currentTurnId,
                status: 'error',
              })
            );
            flushSessionToMemory(state.sessionId, llm).catch((e) =>
              logger.error('memory flush failed:', e)
            );
            return Result.err(new AgentError('STOP_LOOP', 'max stop continuations exceeded'));
          }
          stopContinuations++;
          const injection = stopDecision.injection ?? '(continue)';
          await Effect.runPromise(session.recordUser(state, injection));
          messages.push({ role: 'user', content: injection });
          // Continue to next iteration of for loop
          continue;
        }

        // Normal completion
        yield { _tag: 'Done', content: resp.content };
        lastResult = Result.ok(resp.content);
        await Effect.runPromise(
          hooks.emit('agent.turn.end', {
            sessionId,
            turnId: state.currentTurnId,
            status: 'done',
          })
        );
        break;
      }

      // Emit ToolStart for each tool call so the client can track execution state
      if (toolCalls) {
        for (const tc of toolCalls) {
          yield { _tag: 'ToolStart', id: tc.id, name: tc.name, args: tc.arguments ?? {} };
        }
      }

      // Execute tool calls — record assistant, execute batch, record results in one pipeline
      const allResults = await Effect.runPromise(
        Effect.gen(function* () {
          const record = yield* session.recordAssistant(
            state,
            resp.content,
            toolCalls!,
            model,
            resp.usage
          );
          const results = yield* executor.executeBatch(toolCalls, state.sessionId, {
            turnId: state.currentTurnId,
            projectPath,
            signal: opts.abortSignal,
            approval: opts.approvalOverride,
            agentRunner: { agentService: deps.agentService, llm },
            toolLookup,
          });
          for (const r of results) {
            const resultOut = r.type === 'denied' ? '' : r.output;
            yield* session.recordToolResult(state, record.uuid, r.name, r.id, resultOut);
          }
          return results;
        })
      );

      let todoPrinted = false;
      for (const r of allResults) {
        const resultOut = r.type === 'denied' ? '' : r.output;
        if (r.type === 'denied') {
          yield { _tag: 'ToolDenied', id: r.id, name: r.name, reason: r.reason };
        } else {
          const isOk = r.type === 'ok';
          yield { _tag: 'ToolResult', id: r.id, name: r.name, output: resultOut, ok: isOk };
        }
        if (!messages.find((m) => m.tool_call_id === r.id)) {
          const content =
            r.type === 'denied'
              ? `[Denied] Tool "${r.name}" was denied: ${r.reason}`
              : (r.output ?? '');
          messages.push({ role: 'tool', content, tool_call_id: r.id, tool_name: r.name });
        }
        if (!todoPrinted && r.name === 'todo_write') {
          yield { _tag: 'TodoUpdate', items: sharedTodoStore.read(sessionId) };
          todoPrinted = true;
        }
      }

      // If abort fired during tool execution, terminate immediately
      if (opts.abortSignal?.aborted) {
        yield { _tag: 'Error', error: new AgentError('AGENT_ABORTED', 'cancelled') };
        await Effect.runPromise(
          hooks.emit('agent.turn.end', {
            sessionId,
            turnId: state.currentTurnId,
            status: 'aborted',
          })
        );
        flushSessionToMemory(state.sessionId, llm).catch((e) =>
          logger.error('memory flush failed:', e)
        );
        return Result.err(new AgentError('AGENT_ABORTED', 'cancelled'));
      }
    }

    if (overflow) continue;

    // Turn completed — snapshot
    checkpoint.snapshotFinal(projectPath, state.sessionId, state.currentTurnId);

    // Fire-and-forget memory flush
    flushSessionToMemory(state.sessionId, llm).catch((e) =>
      logger.error('memory flush failed:', e)
    );

    if (lastResult) return lastResult;

    // Max steps exhausted without result
    yield { _tag: 'Error', error: AgentError.maxStepsReached(maxSteps) };
    await Effect.runPromise(
      hooks.emit('agent.turn.end', {
        sessionId,
        turnId: state.currentTurnId,
        status: 'maxSteps',
      })
    );
    return Result.err(AgentError.maxStepsReached(maxSteps));
  }

  yield { _tag: 'Error', error: AgentError.maxStepsReached(maxSteps) };
  await Effect.runPromise(
    hooks.emit('agent.turn.end', {
      sessionId,
      turnId: state.currentTurnId,
      status: 'maxSteps',
    })
  );
  flushSessionToMemory(state.sessionId, llm).catch((e) => logger.error('memory flush failed:', e));
  return Result.err(AgentError.maxStepsReached(maxSteps));
}
