import { z } from 'zod';
import { Layer } from 'effect';
import type { ToolDescription } from '@codingcode/model';
import type { ToolDefinition } from './types.js';
import { ToolRegistryService } from './port.js';
import { canonicalizeSchema } from './utils/canonicalize-schema.js';

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition<any, any>>();

  register(...definitions: ToolDefinition<any, any>[]): void {
    for (const definition of definitions) {
      if (this.tools.has(definition.name)) {
        throw new Error(`Tool already registered: ${definition.name}`);
      }
      this.tools.set(definition.name, definition);
    }
  }

  get(name: string, allowedTools?: ReadonlySet<string>): ToolDefinition<any, any> | undefined {
    if (allowedTools && !allowedTools.has(name)) return undefined;
    return this.tools.get(name);
  }

  list(allowedTools?: ReadonlySet<string>): ToolDefinition<any, any>[] {
    return Array.from(this.tools.values()).filter(
      (tool) => !allowedTools || allowedTools.has(tool.name)
    );
  }

  describe(allowedTools?: ReadonlySet<string>): ToolDescription[] {
    return this.list(allowedTools).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: canonicalizeSchema(z.toJSONSchema(tool.parameters)) as Record<string, unknown>,
    }));
  }
}

export const makeToolRegistryLayer = (
  definitions: readonly ToolDefinition<any, any>[] = []
): Layer.Layer<ToolRegistryService> =>
  Layer.sync(ToolRegistryService, () => {
    const registry = new ToolRegistry();
    registry.register(...definitions);
    return registry;
  });
