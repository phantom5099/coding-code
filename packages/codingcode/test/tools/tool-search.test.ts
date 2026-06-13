import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { createToolSearchTool } from '../../src/tools/domains/self/tool-search.js';
import { ToolSearchService } from '../../src/tools/tool-search-service.js';
import type { ToolDefinition } from '../../src/tools/types.js';

describe('createToolSearchTool', () => {
  it('returns loaded tool list when matches found', async () => {
    const tool = createToolSearchTool();

    // Build a layer: start from Default, then register deferred tools
    const setupAndRun = Effect.gen(function* () {
      const svc = yield* ToolSearchService;
      svc.registerDeferred({
        name: 'todo_write',
        shortDescription: 'Write tasks',
      } as ToolDefinition);
      return yield* tool.execute({ query: 'todo' }, { sessionId: 'test-agent' });
    });

    const result = await Effect.runPromise(
      setupAndRun.pipe(Effect.provide(ToolSearchService.Default))
    );
    expect(result).toContain('Loaded 1 tool(s)');
    expect(result).toContain('todo_write');
  });

  it('returns no-match message when no hits', async () => {
    const tool = createToolSearchTool();

    const setupAndRun = Effect.gen(function* () {
      const svc = yield* ToolSearchService;
      // Register something that won't match
      svc.registerDeferred({
        name: 'unrelated_tool',
        shortDescription: 'Something else',
      } as ToolDefinition);
      return yield* tool.execute({ query: 'zzznonexistent' }, { sessionId: 'test-agent' });
    });

    const result = await Effect.runPromise(
      setupAndRun.pipe(Effect.provide(ToolSearchService.Default))
    );
    expect(result).toBe('No deferred tools matched "zzznonexistent".');
  });

  it('fails with AgentError if sessionId is missing', async () => {
    const tool = createToolSearchTool();

    const exit = await Effect.runPromiseExit(
      tool.execute({ query: 'anything' }, {}).pipe(
        Effect.provide(ToolSearchService.Default)
      )
    );
    expect(exit._tag).toBe('Failure');
  });

  it('each tool instance uses the same service but different deferred registrations', async () => {
    const tool1 = createToolSearchTool();
    const tool2 = createToolSearchTool();

    const setupAndRun = Effect.gen(function* () {
      const svc = yield* ToolSearchService;
      svc.registerDeferred({ name: 'tool_a', shortDescription: 'Tool A' } as ToolDefinition);
      svc.registerDeferred({ name: 'tool_b', shortDescription: 'Tool B' } as ToolDefinition);

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
