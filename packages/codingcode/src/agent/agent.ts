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
import { buildSystemPrompt } from '../prompts/index.js';
import { getWorkspaceCwd } from '../core/workspace.js';
import { resolveConfig } from './config.js';
import { getContextConfig } from '../context/config.js';

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
  | { readonly _tag: 'Done'; readonly content: string };

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

export class AgentService extends Effect.Service<AgentService>()('Agent', {
  effect: Effect.gen(function* () {
    const executor = yield* ToolExecutorService;
    const toolRegistry = yield* ToolService;
    const ctx = yield* ContextService;
    const session = yield* SessionService;
    const checkpoint = yield* CheckpointService;
    const maxSteps = resolveConfig().maxSteps;

    return {
      runStream: (
        state: SessionStoreState,
        llm: LLMStreamAdapter,
        skillInstruction?: string,
      ): AsyncGenerator<AgentEvent, Result<string, AgentError>, unknown> =>
        runReActLoop(state, maxSteps, llm, executor, toolRegistry, ctx, session, checkpoint, skillInstruction),
    };
  }),
}) {}

export async function* runReActLoop(
  state: SessionStoreState,
  maxSteps: number,
  llm: LLMStreamAdapter,
  executor: ToolExecutorService,
  toolRegistry: ToolService,
  ctx: ContextService,
  session: SessionService,
  checkpoint: CheckpointService,
  skillInstruction?: string,
): AsyncGenerator<AgentEvent, Result<string, AgentError>, unknown> {
  const projectPath = state.cwd;
  const basePrompt = buildSystemPrompt({
    cwd: getWorkspaceCwd(),
    platform: process.platform,
    shell: process.env.SHELL || process.env.ComSpec || 'bash',
  });
  const system = skillInstruction
    ? `${basePrompt}\n\n## Skill Instructions\n\n${skillInstruction}`
    : basePrompt;
  const config = getContextConfig();
  const maxOverflowRetries = config.reactiveCompactMaxRetries;
  const model = state.sessionMeta?.model ?? 'unknown';

  for (let attempt = 0; attempt <= maxOverflowRetries; attempt++) {
    const messages = Effect.runSync(ctx.build(state.sessionId));
    let lastResult: Result<string, AgentError> | null = null;
    let overflow = false;

    for (let step = 0; step < maxSteps; step++) {
      yield { _tag: 'Step', step: step + 1, max: maxSteps };

      const tools: ToolDescription[] = toolRegistry.describeAll();

      const { stream: rawStream, response: respPromise } = llm.completeStream({
        messages, system, tools, maxSteps: 1,
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
        yield { _tag: 'Done', content: resp.content };
        lastResult = Result.ok(resp.content);
        break;
      }

      const allResults = await Effect.runPromise(
        executor.executeBatch(toolCalls, state.sessionId, { turnId: state.currentTurnId, projectPath }),
      );

      for (const r of allResults) {
        if (r.type === 'denied') {
          yield { _tag: 'ToolDenied', name: r.name, reason: r.reason };
        } else {
          yield { _tag: 'ToolResult', id: r.id, name: r.name, output: r.output, ok: r.type === 'ok' };
        }
        // Persist tool result
        Effect.runSync(session.recordToolResult(state, assistantUuid, r.name, r.id, r.output ?? ''));
      }

      for (const r of allResults) {
        if (messages.find(m => (m as any).tool_call_id === r.id)) continue;
        const content = r.type === 'denied'
          ? `[Denied] Tool "${r.name}" was denied: ${r.reason}`
          : r.output ?? '';
        messages.push({ role: 'tool', content, tool_call_id: r.id, tool_name: r.name });
      }
    }

    if (overflow) continue;

    // Turn completed — snapshot and compact
    checkpoint.snapshotFinal(projectPath, state.sessionId, state.currentTurnId);
    await Effect.runPromise(ctx.appendTurnEnd(state.sessionId, llm));
    if (lastResult) return lastResult;

    // Max steps exhausted without result
    yield { _tag: 'Error', error: AgentError.maxStepsReached(maxSteps) };
    return Result.err(AgentError.maxStepsReached(maxSteps));
  }

  yield { _tag: 'Error', error: AgentError.maxStepsReached(maxSteps) };
  return Result.err(AgentError.maxStepsReached(maxSteps));
}
