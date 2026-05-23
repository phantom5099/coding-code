import { Effect } from 'effect';
import type { Message, ToolCall } from '../core/types.js';
import { AgentError } from '../core/error.js';
import { Result } from '../core/result.js';
import type { ToolDescription } from '../tools/types.js';
import { ToolService } from '../tools/registry.js';
import { ToolExecutorService } from '../tools/executor.js';
import { ContextService } from '../context/context.js';
import { SessionService, type SessionStoreState } from '../session/store.js';
import { CheckpointService } from '../checkpoint/checkpoint-service.js';
import { buildSystemPrompt, type SystemPromptVariant } from '../prompts/index.js';
import { getWorkspaceCwd } from '../core/workspace.js';
import { resolveConfig } from './config.js';
import { getContextConfig } from '../context/config.js';
import { ToolSearchService } from '../tools/tool-search-service.js';
import { AgentIdResolver } from '../agent-state/agent-id.js';
import { sharedTodoStore } from '../agent-state/todo/service.js';
import { buildToolsForAgent, buildDeferredCatalogContent } from './build-tools.js';
import { HookService } from '../hooks/registry.js';

export type AgentEvent =
  | { readonly _tag: 'LlmChunk'; readonly text: string }
  | { readonly _tag: 'Assistant'; readonly content: string; readonly toolCalls?: ToolCall[] }
  | { readonly _tag: 'ToolStart'; readonly name: string; readonly args: Record<string, unknown> }
  | { readonly _tag: 'ToolDenied'; readonly name: string; readonly reason: string }
  | { readonly _tag: 'ApprovalRequest'; readonly id: string; readonly tool: string; readonly args: Record<string, unknown> }
  | { readonly _tag: 'ToolResult'; readonly id: string; readonly name: string; readonly output: string; readonly ok: boolean }
  | { readonly _tag: 'Step'; readonly step: number; readonly max: number }
  | { readonly _tag: 'ReactiveCompact'; readonly attempt: number; readonly released: number }
  | { readonly _tag: 'Error'; readonly error: AgentError }
  | { readonly _tag: 'Done'; readonly content: string }
  | { readonly _tag: 'TodoUpdate'; readonly items: ReadonlyArray<{ readonly step: string; readonly status: 'pending' | 'completed' | 'cancelled' }> };

export interface RunStreamOptions {
  state: SessionStoreState;
  llm: LLMStreamAdapter;
  agentId?: string;
  skillInstruction?: string;
  systemPromptVariant?: SystemPromptVariant;
  systemOverride?: string;
  coreAllowlist?: ReadonlySet<string>;
  abortSignal?: AbortSignal;
  parentAgentId?: string;
  agentName?: string;
  maxStepsOverride?: number;
  maxStopContinuations?: number;
  approvalOverride?: any;
}

interface LLMStreamAdapter {
  completeStream(params: {
    messages: Message[];
    system?: string;
    tools?: ToolDescription[];
    maxSteps?: number;
  }): {
    stream: AsyncIterable<string>;
    response: Promise<Result<{ content: string; toolCalls?: ToolCall[] }, AgentError>>;
  };
}

interface RunReActDeps {
  maxSteps: number;
  executor: ToolExecutorService;
  toolRegistry: ToolService;
  toolSearch: ToolSearchService;
  agentIdResolver: AgentIdResolver;
  ctx: ContextService;
  session: SessionService;
  checkpoint: CheckpointService;
  hooks: any; // HookService
}

export class AgentService extends Effect.Service<AgentService>()('Agent', {
  effect: Effect.gen(function* () {
    const executor = yield* ToolExecutorService;
    const toolRegistry = yield* ToolService;
    const toolSearch = yield* ToolSearchService;
    const agentIdResolver = yield* AgentIdResolver;
    const ctx = yield* ContextService;
    const session = yield* SessionService;
    const checkpoint = yield* CheckpointService;
    const hooks = yield* HookService;
    const maxSteps = resolveConfig().maxSteps;

    return {
      runStream: (opts: RunStreamOptions): AsyncGenerator<AgentEvent, Result<string, AgentError>, unknown> =>
        runReActLoop(opts, {
          maxSteps, executor, toolRegistry, toolSearch, agentIdResolver,
          ctx, session, checkpoint, hooks,
        }),
    };
  }),
}) {}

export async function* runReActLoop(
  opts: RunStreamOptions,
  deps: RunReActDeps,
): AsyncGenerator<AgentEvent, Result<string, AgentError>, unknown> {
  const { state, llm, skillInstruction, systemPromptVariant } = opts;
  const agentId = opts.agentId ?? deps.agentIdResolver.resolve(state.sessionId);
  const projectPath = state.cwd;

  // Build system prompt
  const basePrompt = opts.systemOverride ?? buildSystemPrompt({
    cwd: getWorkspaceCwd(),
    platform: process.platform,
    shell: process.env.SHELL || process.env.ComSpec || 'bash',
    variant: systemPromptVariant ?? 'default',
  });
  const skillInstructionStr = opts.skillInstruction ? `\n\n## Skill Instructions\n\n${opts.skillInstruction}` : '';
  const system = `${basePrompt}${skillInstructionStr}`;

  const config = getContextConfig();
  const maxOverflowRetries = config.reactiveCompactMaxRetries;
  const model = state.sessionMeta?.model ?? 'unknown';
  const maxSteps = opts.maxStepsOverride ?? deps.maxSteps;

  const { executor, toolRegistry, toolSearch, ctx, session, checkpoint, hooks } = deps;

  // For stop hook continue logic
  let stopContinuations = 0;
  const maxStopContinuations = opts.maxStopContinuations ?? 2;

  for (let attempt = 0; attempt <= maxOverflowRetries; attempt++) {
    const messages = Effect.runSync(ctx.build(state.sessionId));
    let lastResult: Result<string, AgentError> | null = null;
    let overflow = false;

    // Emit turn.start hook
    await Effect.runPromise(hooks.emit('agent.turn.start', { agentId, sessionId: state.sessionId }));

    for (let step = 0; step < maxSteps; step++) {
      yield { _tag: 'Step', step: step + 1, max: maxSteps };

      // Check abort signal
      if (opts.abortSignal?.aborted) {
        yield { _tag: 'Error', error: new AgentError('AGENT_ABORTED', 'cancelled') };
        await Effect.runPromise(hooks.emit('agent.turn.end', {
          agentId, sessionId: state.sessionId, turnId: state.currentTurnId, status: 'aborted'
        }));
        return Result.err(new AgentError('AGENT_ABORTED', 'cancelled'));
      }

      // Build tools with coreAllowlist filter
      const tools: ToolDescription[] = buildToolsForAgent(toolRegistry, toolSearch, agentId, opts.coreAllowlist);
      const catalog = buildDeferredCatalogContent(toolSearch, agentId);
      const systemWithCatalog = catalog ? `${system}\n\n${catalog}` : system;

      // Emit step.before hook and collect transient messages
      const stepBeforePayload = { agentId, step: step + 1, sessionId: state.sessionId };
      await Effect.runPromise(hooks.emitDecision('agent.step.before', stepBeforePayload));

      // Build LLM messages: original messages + step.before transients
      const llmMessages = [...messages];

      // Add step.before transient messages (if any)
      // Note: transient messages are not persisted to JSONL

      const { stream: rawStream, response: respPromise } = llm.completeStream({
        messages: llmMessages, system: systemWithCatalog, tools, maxSteps: 1,
      });

      for await (const chunk of rawStream) {
        yield { _tag: 'LlmChunk', text: chunk };
      }

      const llmResult = await respPromise;
      if (!llmResult.ok) {
        if (llmResult.error.code === 'CONTEXT_OVERFLOW' && attempt < maxOverflowRetries) {
          const aggressiveConfig = { ...config, L5KeepRecentTurns: config.reactiveCompactKeepTurns };
          const compressResult = await Effect.runPromise(ctx.compress(state.sessionId, null, aggressiveConfig));
          yield { _tag: 'ReactiveCompact', attempt: attempt + 1, released: compressResult.released };
          overflow = true;
          break;
        }
        yield { _tag: 'Error', error: llmResult.error };
        lastResult = Result.err(llmResult.error);
        await Effect.runPromise(hooks.emit('agent.turn.end', {
          agentId, sessionId: state.sessionId, turnId: state.currentTurnId, status: 'error'
        }));
        break;
      }

      const resp = llmResult.value;
      const toolCalls = resp.toolCalls;
      const assistantMsg: Message = { role: 'assistant', content: resp.content };
      if (toolCalls && toolCalls.length > 0) {
        (assistantMsg as any).tool_calls = toolCalls;
      }
      messages.push(assistantMsg);
      yield { _tag: 'Assistant', content: resp.content, toolCalls };

      // Persist assistant event
      const recordResult = Effect.runSync(session.recordAssistant(state, resp.content, toolCalls as any, model));
      const assistantUuid = (recordResult as any).uuid;

      if (!toolCalls || toolCalls.length === 0) {
        // LLM done - check stop hook before returning
        const stopHookPayload = {
          agentId, sessionId: state.sessionId, content: resp.content, turnId: state.currentTurnId
        };
        const stopDecision: any = await Effect.runPromise(hooks.emitDecision('agent.turn.stop', stopHookPayload));

        if (stopDecision && stopDecision.decision === 'continue') {
          // Continue for another iteration
          if (stopContinuations >= maxStopContinuations) {
            yield { _tag: 'Error', error: new AgentError('STOP_LOOP', 'max stop continuations exceeded') };
            await Effect.runPromise(hooks.emit('agent.turn.end', {
              agentId, sessionId: state.sessionId, turnId: state.currentTurnId, status: 'error'
            }));
            return Result.err(new AgentError('STOP_LOOP', 'max stop continuations exceeded'));
          }
          stopContinuations++;
          const injection = stopDecision.injection ?? '(continue)';
          Effect.runSync(session.recordUser(state, injection));
          messages.push({ role: 'user', content: injection });
          // Continue to next iteration of for loop
          continue;
        }

        // Normal completion
        yield { _tag: 'Done', content: resp.content };
        lastResult = Result.ok(resp.content);
        await Effect.runPromise(hooks.emit('agent.turn.end', {
          agentId, sessionId: state.sessionId, turnId: state.currentTurnId, status: 'done'
        }));
        break;
      }

      // Execute tool calls with approvalOverride and agentRunner
      const allResults = await Effect.runPromise(
        executor.executeBatch(toolCalls, state.sessionId, {
          turnId: state.currentTurnId,
          projectPath,
          agentId,
          signal: opts.abortSignal,
          approval: opts.approvalOverride,
          agentRunner: { agentService: undefined, llm }, // Will be set at dispatch time
        }),
      );

      for (const r of allResults) {
        const resultOut = r.type === 'denied' ? '' : r.output;
        if (r.type === 'denied') {
          yield { _tag: 'ToolDenied', name: r.name, reason: r.reason };
        } else {
          yield { _tag: 'ToolResult', id: r.id, name: r.name, output: resultOut, ok: r.type === 'ok' };
        }
        // Persist tool result
        Effect.runSync(session.recordToolResult(state, assistantUuid, r.name, r.id, resultOut));
      }

      for (const r of allResults) {
        if (messages.find(m => (m as any).tool_call_id === r.id)) continue;
        const content = r.type === 'denied'
          ? `[Denied] Tool "${r.name}" was denied: ${r.reason}`
          : r.output ?? '';
        messages.push({ role: 'tool', content, tool_call_id: r.id, tool_name: r.name });
      }

      // Emit TodoUpdate when todo tools are called this turn
      for (const r of allResults) {
        if (r.name === 'todo_write' || r.name === 'todo_read') {
          yield { _tag: 'TodoUpdate', items: sharedTodoStore.read(agentId) as any };
          break;
        }
      }

    }

    if (overflow) continue;

    // Turn completed — snapshot and compact
    checkpoint.snapshotFinal(projectPath, state.sessionId, state.currentTurnId);
    await Effect.runPromise(ctx.appendTurnEnd(state.sessionId, llm as any));
    if (lastResult) return lastResult;

    // Max steps exhausted without result
    yield { _tag: 'Error', error: AgentError.maxStepsReached(maxSteps) };
    await Effect.runPromise(hooks.emit('agent.turn.end', {
      agentId, sessionId: state.sessionId, turnId: state.currentTurnId, status: 'maxSteps'
    }));
    return Result.err(AgentError.maxStepsReached(maxSteps));
  }

  yield { _tag: 'Error', error: AgentError.maxStepsReached(maxSteps) };
  await Effect.runPromise(hooks.emit('agent.turn.end', {
    agentId, sessionId: state.sessionId, turnId: state.currentTurnId, status: 'maxSteps'
  }));
  return Result.err(AgentError.maxStepsReached(maxSteps));
}
