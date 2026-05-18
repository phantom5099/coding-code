import { Effect } from 'effect';
import { AgentError } from '../core/error';
import type { HookService } from '../hooks/registry';
import type { Sandbox } from '../sandbox';
import type { ToolService } from './registry';

export class ToolExecutor {
  constructor(
    private registry: ToolService,
    private hooks: HookService,
    private sandbox: Sandbox,
  ) {}

  getRegistry(): ToolService {
    return this.registry;
  }

  execute(
    name: string,
    args: unknown,
    opts?: { signal?: AbortSignal },
  ): Effect.Effect<string, AgentError> {
    const self = this;
    return Effect.gen(function* () {
      const toolResult = self.registry.get(name);
      if (!toolResult.ok) return yield* Effect.fail(toolResult.error);
      const tool = toolResult.value;

      if (!self.sandbox.allowTool(name)) {
        return yield* Effect.fail(AgentError.toolNotAllowed(name));
      }

      yield* Effect.sync(() => self.hooks.emitSync('tool.execute.before', {
        toolName: name,
        args: args as Record<string, unknown>,
      }));

      const parsedArgs = yield* Effect.sync(() => tool.parameters.parse(args));
      const start = Date.now();
      const result = yield* Effect.tryPromise({
        try: () => tool.execute(parsedArgs, opts?.signal),
        catch: (e) => e instanceof AgentError ? e : AgentError.toolExecutionFailed(name, e),
      });

      const durationMs = Date.now() - start;
      yield* Effect.sync(() => self.hooks.emitSync('tool.execute.after', {
        toolName: name,
        args: args as Record<string, unknown>,
        result,
        durationMs,
      }));

      return result;
    }).pipe(
      Effect.tapError((error) =>
        Effect.sync(() => self.hooks.emitSync('tool.execute.error', {
          toolName: name,
          args: args as Record<string, unknown>,
          error,
        })),
      ),
    );
  }
}
