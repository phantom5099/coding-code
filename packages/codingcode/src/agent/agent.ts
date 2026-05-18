import { Effect } from 'effect';
import type { Message, ToolCall } from '../core/types.js';
import { AgentError } from '../core/error.js';
import { Result } from '../core/result.js';
import type { AgentConfig, AgentEvent } from './types.js';
import { resolveConfig, mergeConfig, type ResolvedConfig } from './config.js';
import type { ToolDescription } from '../tools/types.js';

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

interface ToolExecutorAdapter {
  execute(name: string, args: Record<string, unknown>, opts?: { signal?: AbortSignal }): Effect.Effect<string, AgentError>;
  getRegistry(): {
    describeAll(): Array<{ name: string; description: string; schema: Record<string, unknown> }>;
    filter(names: string[]): Array<{ name: string; description: string; schema: Record<string, unknown> }>;
  };
}

export class AgentService extends Effect.Service<AgentService>()('Agent', {
  effect: Effect.gen(function* () {
    let config: ResolvedConfig = { role: 'coder', systemPrompt: '', maxSteps: 25, availableTools: undefined };

    return {
      init: (cfg: AgentConfig): Effect.Effect<void> =>
        Effect.sync(() => { config = mergeConfig(resolveConfig(cfg.role), cfg); }),

      switchRole: (role: string): Effect.Effect<string> =>
        Effect.sync(() => {
          const oldRole = config.role;
          config = mergeConfig(resolveConfig(role), { ...config, role, availableTools: resolveConfig(role).availableTools });
          return oldRole;
        }),

      getRole: (): Effect.Effect<string> => Effect.succeed(config.role),

      runStream: (
        messages: Message[],
        llm: LLMStreamAdapter,
        executor: ToolExecutorAdapter,
      ): AsyncGenerator<AgentEvent, Result<string, AgentError>, unknown> =>
        runReActLoop(messages, config, llm, executor),
    };
  }),
}) {}

export async function* runReActLoop(
  initialMessages: Message[],
  config: ResolvedConfig,
  llm: LLMStreamAdapter,
  executor: ToolExecutorAdapter,
): AsyncGenerator<AgentEvent, Result<string, AgentError>, unknown> {
  const messages = [...initialMessages];
  const maxSteps = config.maxSteps;

  for (let step = 0; step < maxSteps; step++) {
    yield { _tag: 'Step', step: step + 1, max: maxSteps };

    const registry = executor.getRegistry();
    const tools: ToolDescription[] = config.availableTools
      ? registry.filter(config.availableTools).map((t) => ({
          name: t.name, description: t.description, parameters: t.schema,
        }))
      : registry.describeAll().map((t) => ({
          name: t.name, description: t.description, parameters: t.schema,
        }));

    const { stream: rawStream, response: respPromise } = llm.completeStream({
      messages, system: config.systemPrompt, tools, maxSteps: 1,
    });

    for await (const chunk of rawStream) {
      yield { _tag: 'LlmChunk', text: chunk };
    }

    const llmResult = await respPromise;
    if (!llmResult.ok) {
      yield { _tag: 'Error', error: llmResult.error };
      return Result.err(llmResult.error);
    }

    const resp = llmResult.value;
    const toolCalls = resp.toolCalls;
    const assistantMsg: Message = { role: 'assistant', content: resp.content };
    if (toolCalls && toolCalls.length > 0) {
      (assistantMsg as any).tool_calls = toolCalls;
    }
    messages.push(assistantMsg);
    yield { _tag: 'Assistant', content: resp.content, toolCalls };

    if (!toolCalls || toolCalls.length === 0) {
      yield { _tag: 'Done', content: resp.content };
      return Result.ok(resp.content);
    }

    // Concurrent tool execution — executor.execute returns Effect directly
    const controllers = toolCalls.map(() => new AbortController());
    const results = await Effect.runPromise(
      Effect.forEach(toolCalls, (tc, i) =>
        executor.execute(tc.name, tc.arguments ?? {}, { signal: controllers[i].signal }).pipe(
          Effect.map((result) => ({ id: tc.id, name: tc.name, ok: true as const, output: result })),
          Effect.catchAllCause((cause) => {
            const err = cause instanceof AgentError ? cause : AgentError.toolExecutionFailed(tc.name, String(cause));
            return Effect.succeed({ id: tc.id, name: tc.name, ok: false as const, output: `[Error: ${err.code}] ${err.message}` });
          }),
        ),
      { concurrency: 'unbounded' },
    ) as any,
    );

    for (const r of (results as any[])) {
      messages.push({ role: 'tool', content: r.output, tool_call_id: r.id, tool_name: r.name });
      yield { _tag: 'ToolResult', id: r.id, name: r.name, output: r.output, ok: r.ok };
    }
  }

  yield { _tag: 'Error', error: AgentError.maxStepsReached(maxSteps) };
  return Result.err(AgentError.maxStepsReached(maxSteps));
}
