import { AgentError } from '../core/error';
import { Result } from '../core/result';
import type { ToolDefinition, ToolDescription } from './types';

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  get(name: string): Result<ToolDefinition, AgentError> {
    const t = this.tools.get(name);
    return t ? Result.ok(t) : Result.err(AgentError.toolNotFound(name));
  }

  describeAll(): ToolDescription[] {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.schema,
    }));
  }

  filter(names: string[]): ToolDefinition[] {
    return names
      .map((n) => this.tools.get(n))
      .filter((t): t is ToolDefinition => t !== undefined);
  }
}
