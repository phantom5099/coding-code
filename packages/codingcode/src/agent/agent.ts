import { Effect } from 'effect';
import type { Message, ToolCall } from '../core/types.js';
import { AgentError } from '../core/error.js';
import { Result } from '../core/result.js';
import type { AgentConfig, ReActEvent } from './types.js';
import { resolveConfig, mergeConfig, type ResolvedConfig } from './config.js';
import type { ToolDescription } from '../tools/types.js';

interface LLMStreamAdapter {
  completeStream(params: {
    messages: Message[];
    system?: string;
    tools?: ToolDescription[];
    maxSteps?: number;
  }): {
    stream: AsyncGenerator<string>;
    response: Promise<Result<{ content: string; toolCalls?: ToolCall[] }, AgentError>>;
  };
}

interface ToolExecutorAdapter {
  execute(name: string, args: Record<string, unknown>, opts?: { signal?: AbortSignal }): Promise<Result<string, AgentError>>;
  getRegistry(): {
    describeAllSync(): Array<{ name: string; description: string; schema: Record<string, unknown> }>;
    filterSync(names: string[]): Array<{ name: string; description: string; schema: Record<string, unknown> }>;
  };
}

export class AgentService extends Effect.Service<AgentService>()('Agent', {
  effect: Effect.gen(function* () {
    let config: ResolvedConfig = { role: 'coder', systemPrompt: '', maxSteps: 25, availableTools: undefined };

    return {
      init: (cfg: AgentConfig): Effect.Effect<void> =>
        Effect.sync(() => {
          config = mergeConfig(resolveConfig(cfg.role), cfg);
        }),

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
      ): AsyncGenerator<ReActEvent, Result<string, AgentError>, unknown> =>
        runReActLoop(messages, config, llm, executor),
    };
  }),
}) {}

export async function* runReActLoop(
  initialMessages: Message[],
  config: ResolvedConfig,
  llm: LLMStreamAdapter,
  executor: ToolExecutorAdapter,
): AsyncGenerator<ReActEvent, Result<string, AgentError>, unknown> {
  const messages = [...initialMessages];
  const maxSteps = config.maxSteps;

  for (let step = 0; step < maxSteps; step++) {
    yield { type: 'step', step: step + 1, max: maxSteps };

    const registry = executor.getRegistry();
    const tools: ToolDescription[] = config.availableTools
      ? registry.filterSync(config.availableTools).map((t) => ({
          name: t.name, description: t.description, parameters: t.schema,
        }))
      : registry.describeAllSync().map((t) => ({
          name: t.name, description: t.description, parameters: t.schema,
        }));

    const { stream, response } = llm.completeStream({ messages, system: config.systemPrompt, tools, maxSteps: 1 });

    for await (const chunk of stream) {
      yield { type: 'text', text: chunk };
    }

    const llmResult = await response;
    if (!llmResult.ok) {
      yield { type: 'error', error: llmResult.error };
      return Result.err(llmResult.error);
    }

    const resp = llmResult.value;
    const toolCalls = resp.toolCalls;
    const assistantMsg: Message = { role: 'assistant', content: resp.content };
    if (toolCalls && toolCalls.length > 0) {
      (assistantMsg as any).tool_calls = toolCalls;
    }
    messages.push(assistantMsg);
    yield { type: 'assistant', content: resp.content, toolCalls };

    if (!toolCalls || toolCalls.length === 0) {
      return Result.ok(resp.content);
    }

    // Fiber concurrent tool execution
    const controllers = toolCalls.map(() => new AbortController());
    const results = await Effect.runPromise(
      Effect.forEach(
        toolCalls,
        (tc, i) =>
          Effect.tryPromise({
            try: () => executor.execute(tc.name, tc.arguments ?? {}, { signal: controllers[i].signal }),
            catch: (cause) => AgentError.toolExecutionFailed(tc.name, String(cause)),
          }).pipe(
            Effect.map((result) => ({ id: tc.id, name: tc.name, result })),
            Effect.catchAllCause((cause) =>
              Effect.succeed({
                id: tc.id,
                name: tc.name,
                result: Result.err(AgentError.toolExecutionFailed(tc.name, String(cause))),
              }),
            ),
          ),
        { concurrency: 'unbounded' },
      ),
    );

    // Yield results in original order
    for (const r of results) {
      const output = r.result.ok ? r.result.value : `[Error: ${r.result.error.code}] ${r.result.error.message}`;
      messages.push({ role: 'tool', content: output, tool_call_id: r.id, tool_name: r.name });
      yield {
        type: 'toolResult',
        id: r.id,
        name: r.name,
        output,
        ok: r.result.ok,
      };
    }
  }

  return Result.err(AgentError.maxStepsReached(maxSteps));
}
