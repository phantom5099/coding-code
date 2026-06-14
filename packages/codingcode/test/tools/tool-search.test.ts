import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { createToolSearchTool } from '../../src/tools/domains/self/tool-search.js';
import { ToolSearchService } from '../../src/tools/tool-search-service.js';
import type { ToolDefinition } from '../../src/tools/types.js';

describe('createToolSearchTool', () => {
  it('returns loaded tool list when matches found', async () => {
    const setupAndRun = Effect.gen(function* () {
      const svc = yield* ToolSearchService;
      svc.registerDeferred({
        name: 'todo_write',
        shortDescription: 'Write tasks',
      } as ToolDefinition);
      const tool = yield* createToolSearchTool();
      return yield* tool.execute({ query: 'todo' }, { sessionId: 'test-agent' });
    });

    const result = await Effect.runPromise(
      setupAndRun.pipe(Effect.provide(ToolSearchService.Default))
    );
    expect(result).toContain('Loaded 1 tool(s)');
    expect(result).toContain('todo_write');
  });

  it('returns no-match message when no hits', async () => {
    const setupAndRun = Effect.gen(function* () {
      const svc = yield* ToolSearchService;
      svc.registerDeferred({
        name: 'unrelated_tool',
        shortDescription: 'Something else',
      } as ToolDefinition);
      const tool = yield* createToolSearchTool();
      return yield* tool.execute({ query: 'zzznonexistent' }, { sessionId: 'test-agent' });
    });

    const result = await Effect.runPromise(
      setupAndRun.pipe(Effect.provide(ToolSearchService.Default))
    );
    expect(result).toBe('No deferred tools matched "zzznonexistent".');
  });

  it('fails with AgentError if sessionId is missing', async () => {
    const setupAndRun = Effect.gen(function* () {
      const tool = yield* createToolSearchTool();
      return yield* Effect.flip(tool.execute({ query: 'anything' }, {}));
    });

    const error = await Effect.runPromise(
      setupAndRun.pipe(Effect.provide(ToolSearchService.Default))
    );
    expect(error.name).toBe('AgentError');
  });

  it('each tool instance uses the same service but different deferred registrations', async () => {
    const setupAndRun = Effect.gen(function* () {
      const svc = yield* ToolSearchService;
      svc.registerDeferred({ name: 'tool_a', shortDescription: 'Tool A' } as ToolDefinition);
      svc.registerDeferred({ name: 'tool_b', shortDescription: 'Tool B' } as ToolDefinition);

      const tool1 = yield* createToolSearchTool();
      const tool2 = yield* createToolSearchTool();

      const r1 = yield* tool1.execute({ query: 'a' }, { sessionId: 'session-1' });
      const r2 = yield* tool2.execute({ query: 'b' }, { sessionId: 'session-2' });
      return { r1, r2 };
    });

    const { r1, r2 } = await Effect.runPromise(
      setupAndRun.pipe(Effect.provide(ToolSearchService.Default))
    );

    expect(r1).toContain('tool_a');
    expect(r2).toContain('tool_b');
  });
});
