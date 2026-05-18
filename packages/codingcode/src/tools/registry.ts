import { Effect } from 'effect';
import { AgentError } from '../core/error';
import { Result } from '../core/result';
import type { ToolDefinition, ToolDescription } from './types';

export class ToolService extends Effect.Service<ToolService>()('ToolService', {
  effect: Effect.gen(function* () {
    const tools = new Map<string, ToolDefinition>();

    return {
      register: (tool: ToolDefinition): Effect.Effect<void> =>
        Effect.sync(() => {
          if (tools.has(tool.name)) {
            console.warn(`[ToolService] '${tool.name}' already registered, skipping`);
            return;
          }
          tools.set(tool.name, tool);
        }),

      get: (name: string): Result<ToolDefinition, AgentError> => {
        const t = tools.get(name);
        return t ? Result.ok(t) : Result.err(AgentError.toolNotFound(name));
      },

      describeAll: (): ToolDescription[] =>
        Array.from(tools.values()).map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.schema,
        })),

      filter: (names: string[]): ToolDefinition[] =>
        names
          .map((n) => tools.get(n))
          .filter((t): t is ToolDefinition => t !== undefined),
    };
  }),
}) {}
