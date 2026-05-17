import { Effect } from 'effect';
import type { Message, ToolCall } from '../core/types.js';
import { AgentError } from '../core/error.js';
import { Result } from '../core/result.js';
import { ContextService } from '../context/context.js';
import { Bus } from '../bus/bus.js';
import type { AgentConfig } from './types.js';
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
  execute(name: string, args: Record<string, unknown>): Promise<Result<string, AgentError>>;
  getRegistry(): {
    describeAll(): Array<{ name: string; description: string; schema: Record<string, unknown> }>;
    filter(names: string[]): Array<{ name: string; description: string; schema: Record<string, unknown> }>;
  };
}

export class AgentService extends Effect.Service<AgentService>()('Agent', {
  effect: Effect.gen(function* () {
    const context = yield* ContextService;
    const bus = yield* Bus;

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

      compactContext: () =>
        Effect.gen(function* () {
          const result = yield* context.compress();
          if (result.didCompress) {
            yield* (bus.publish({ type: 'compaction', didCompress: true, summary: result.summary }) as Effect.Effect<void>);
          }
          return result;
        }) as Effect.Effect<import('../context/compaction.js').CompressResult>,

      runStream: (llm: LLMStreamAdapter, executor: ToolExecutorAdapter): AsyncGenerator<string, Result<string, AgentError>, unknown> =>
        runReActLoop(context, bus, config, llm, executor),
    };
  }),
}) {}

// 纯异步生成器函数——流式 ReAct 循环
async function* runReActLoop(
  context: ContextService,
  bus: { publish: (e: import('../bus/bus.js').BusEvent) => Effect.Effect<void> },
  config: ResolvedConfig,
  llm: LLMStreamAdapter,
  executor: ToolExecutorAdapter,
): AsyncGenerator<string, Result<string, AgentError>, unknown> {
  const maxSteps = config.maxSteps;

  for (let step = 0; step < maxSteps; step++) {
    // 用 Effect.runPromise 桥接 Effect 调用
    const messages = await Effect.runPromise(context.build());
    const tools: ToolDescription[] = config.availableTools
      ? executor.getRegistry().filter(config.availableTools).map((t) => ({
          name: t.name, description: t.description, parameters: t.schema,
        }))
      : executor.getRegistry().describeAll().map((t) => ({
          name: t.name, description: t.description, parameters: t.schema,
        }));

    await Effect.runPromise(bus.publish({ type: 'step', step: step + 1, max: maxSteps }));

    const { stream, response } = llm.completeStream({ messages, system: config.systemPrompt, tools, maxSteps: 1 });

    for await (const chunk of stream) {
      yield chunk;
    }

    const llmResult = await response;
    if (!llmResult.ok) {
      await Effect.runPromise(bus.publish({ type: 'error', error: llmResult.error }));
      return Result.err(llmResult.error);
    }

    const resp = llmResult.value;
    await Effect.runPromise(context.addAssistant(resp.content, (resp as any).toolCalls));

    if (!resp.toolCalls || resp.toolCalls.length === 0) {
      return Result.ok(resp.content);
    }

    for (const tc of resp.toolCalls) {
      yield `\n[Using: ${tc.function.name}]\n`;
      await Effect.runPromise(bus.publish({
        type: 'toolCall',
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
      }));
      const toolResult = await executor.execute(tc.function.name, JSON.parse(tc.function.arguments));
      const output = toolResult.ok ? toolResult.value : `[Error: ${toolResult.error.code}] ${toolResult.error.message}`;
      await Effect.runPromise(context.addToolResult(tc.id, output, tc.function.name));
    }
  }

  return Result.err(AgentError.maxStepsReached(maxSteps));
}
