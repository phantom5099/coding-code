import { AgentError } from '../core/error';
import type { HookService } from '../hooks/registry';
import { Result } from '../core/result';
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

  async execute(
    name: string,
    args: unknown,
    opts?: { signal?: AbortSignal },
  ): Promise<Result<string, AgentError>> {
    const toolResult = this.registry.getSync(name);
    if (!toolResult.ok) return toolResult;
    const tool = toolResult.value;

    if (!this.sandbox.allowTool(name)) {
      return Result.err(AgentError.toolNotAllowed(name));
    }

    await this.hooks.emitSync('tool.execute.before', {
      toolName: name,
      args: args as Record<string, unknown>,
    });

    const start = Date.now();
    try {
      const parsedArgs = tool.parameters.parse(args);
      const result = await tool.execute(parsedArgs, opts?.signal);
      const durationMs = Date.now() - start;
      await this.hooks.emitSync('tool.execute.after', {
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
      await this.hooks.emitSync('tool.execute.error', {
        toolName: name,
        args: args as Record<string, unknown>,
        error,
      });
      return Result.err(error);
    }
  }
}
