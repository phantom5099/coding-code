import { AgentError } from '../core/error';
import type { HookRegistry } from '../core/hooks';
import { Result } from '../core/result';
import type { Sandbox } from '../sandbox';
import type { ToolRegistry } from './registry';

export class ToolExecutor {
  constructor(
    private registry: ToolRegistry,
    private hooks: HookRegistry,
    private sandbox: Sandbox,
  ) {}

  getRegistry(): ToolRegistry {
    return this.registry;
  }

  async execute(
    name: string,
    args: unknown,
    signal?: AbortSignal,
  ): Promise<Result<string, AgentError>> {
    const toolResult = this.registry.get(name);
    if (!toolResult.ok) return toolResult;
    const tool = toolResult.value;

    if (!this.sandbox.allowTool(name)) {
      return Result.err(AgentError.toolNotAllowed(name));
    }

    await this.hooks.emit('tool.execute.before', {
      toolName: name,
      args: args as Record<string, unknown>,
    });

    const start = Date.now();
    try {
      const result = await tool.execute(args, signal);
      const durationMs = Date.now() - start;
      await this.hooks.emit('tool.execute.after', {
        toolName: name,
        args: args as Record<string, unknown>,
        result,
        durationMs,
      });
      return Result.ok(result);
    } catch (e) {
      const error =
        e instanceof AgentError
          ? e
          : AgentError.toolExecutionFailed(name, e);
      await this.hooks.emit('tool.execute.error', {
        toolName: name,
        args: args as Record<string, unknown>,
        error,
      });
      return Result.err(error);
    }
  }
}
