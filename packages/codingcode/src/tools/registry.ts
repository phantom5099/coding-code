import { z } from 'zod';
import type { ToolDefinition, ToolDescription } from './types.js';
import { canonicalizeSchema } from './utils/canonicalize-schema.js';

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(...definitions: ToolDefinition[]): void {
    for (const definition of definitions) {
      if (this.tools.has(definition.name)) {
        throw new Error(`Tool already registered: ${definition.name}`);
      }
      this.tools.set(definition.name, definition);
    }
  }

  get(name: string, allowedTools?: ReadonlySet<string>): ToolDefinition | undefined {
    if (allowedTools && !allowedTools.has(name)) return undefined;
    return this.tools.get(name);
  }

  describe(allowedTools?: ReadonlySet<string>): ToolDescription[] {
    return Array.from(this.tools.values())
      .filter((tool) => !allowedTools || allowedTools.has(tool.name))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: canonicalizeSchema(z.toJSONSchema(tool.parameters)) as Record<string, unknown>,
      }));
  }
}
