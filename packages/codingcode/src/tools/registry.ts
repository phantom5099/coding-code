import { z } from 'zod';
import { Effect } from 'effect';
import { AgentError } from '../core/error';
import { Result } from '../core/result';
import type { ToolDefinition, ToolDescription } from './types';

// Module-level singleton: shared across all Effect.runPromise scopes
const tools = new Map<string, ToolDefinition>();

export class ToolService extends Effect.Service<ToolService>()('ToolService', {
  effect: Effect.gen(function* () {
    return {
      register: (tool: ToolDefinition): Effect.Effect<void> =>
        Effect.sync(() => {
          if (tools.has(tool.name)) return; // skip duplicates silently
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
          parameters: t.jsonSchema ?? (z.toJSONSchema(t.parameters) as Record<string, unknown>),
        })),

      filter: (names: string[]): ToolDefinition[] =>
        names
          .map((n) => tools.get(n))
          .filter((t): t is ToolDefinition => t !== undefined),
    };
  }),
}) {}
