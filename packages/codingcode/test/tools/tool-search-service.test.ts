import { describe, it, expect, beforeEach } from 'vitest';
import { Effect, Layer } from 'effect';
import { ToolService } from '../../../src/tools/registry.js';
import { ToolSearchService } from '../../../src/tools/tool-search-service.js';
import type { ToolDefinition } from '../../../src/tools/types.js';
import { z } from 'zod';

const toolLayer = ToolService.Default;
const searchLayer = ToolSearchService.Default.pipe(Layer.provide(toolLayer));
const layer = Layer.mergeAll(toolLayer, searchLayer);

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(layer) as any));
}

function makeDeferred(name: string, shortDesc?: string): ToolDefinition {
  return {
    name,
    description: `Tool ${name}`,
    shortDescription: shortDesc,
    deferred: true,
    parameters: z.object({}),
    execute: async () => `result-${name}`,
  };
}

/** Reset the module-level loaded state via Effect. */
function resetSearch(): Promise<void> {
  return run(Effect.gen(function* () {
    const svc = yield* ToolSearchService;
    svc.reset();
  }));
}

describe('ToolSearchService', () => {
  beforeEach(async () => {
    await resetSearch();
  });

  it('listUnloadedDeferred returns all deferred tools initially', async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      yield* tools.register(makeDeferred('def_a'));
      yield* tools.register(makeDeferred('def_b'));

      const svc = yield* ToolSearchService;
      const unloaded = svc.listUnloadedDeferred('agent-1');
      expect(unloaded.map(t => t.name)).toContain('def_a');
      expect(unloaded.map(t => t.name)).toContain('def_b');
    });
    await run(program);
  });

  it('search loads matching tools and removes from unloaded', async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      yield* tools.register(makeDeferred('todo_write', 'Write task list'));
      yield* tools.register(makeDeferred('todo_read', 'Read tasks'));
      yield* tools.register(makeDeferred('z_other'));

      const svc = yield* ToolSearchService;
      const hits = svc.search('agent-1', 'todo');
      const hitNames = hits.map(h => h.name).sort();
      expect(hitNames).toContain('todo_read');
      expect(hitNames).toContain('todo_write');
      expect(hitNames).not.toContain('z_other');

      // Loaded tools are no longer in unloaded list
      const unloadedNames = svc.listUnloadedDeferred('agent-1').map(t => t.name);
      expect(unloadedNames).not.toContain('todo_read');
      expect(unloadedNames).not.toContain('todo_write');
      expect(unloadedNames).toContain('z_other');
    });
    await run(program);
  });

  it('different agentIds have independent loaded state', async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      yield* tools.register(makeDeferred('tool_x'));

      const svc = yield* ToolSearchService;
      svc.search('agent-alpha', 'tool');
      expect(svc.isLoaded('agent-alpha', 'tool_x')).toBe(true);
      expect(svc.isLoaded('agent-beta', 'tool_x')).toBe(false);
    });
    await run(program);
  });

  it('repeated search with same query returns empty on second call', async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      yield* tools.register(makeDeferred('my_tool'));

      const svc = yield* ToolSearchService;
      const first = svc.search('agent-rep', 'my_tool');
      expect(first).toHaveLength(1);

      const second = svc.search('agent-rep', 'my_tool');
      expect(second).toHaveLength(0);
    });
    await run(program);
  });

  it('multi-token search uses AND semantics', async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      yield* tools.register(makeDeferred('todo_write', 'Write task list'));
      yield* tools.register(makeDeferred('web_search', 'Search the web'));

      const svc = yield* ToolSearchService;
      const hits = svc.search('agent-and', 'task list');
      expect(hits).toHaveLength(1);
      expect(hits[0]!.name).toBe('todo_write');
    });
    await run(program);
  });

  it('empty query returns empty array', async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      yield* tools.register(makeDeferred('some_tool'));

      const svc = yield* ToolSearchService;
      expect(svc.search('agent-empty', '')).toHaveLength(0);
      expect(svc.search('agent-empty', '   ')).toHaveLength(0);
    });
    await run(program);
  });

  it('isLoaded reflects search results', async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      yield* tools.register(makeDeferred('target_tool'));

      const svc = yield* ToolSearchService;
      expect(svc.isLoaded('agent-load', 'target_tool')).toBe(false);

      svc.search('agent-load', 'target');
      expect(svc.isLoaded('agent-load', 'target_tool')).toBe(true);
    });
    await run(program);
  });

  it('listLoaded returns loaded tool names', async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      yield* tools.register(makeDeferred('zzz_first'));

      const svc = yield* ToolSearchService;
      svc.search('agent-list', 'first');
      const loaded = svc.listLoaded('agent-list');
      expect(loaded).toContain('zzz_first');
    });
    await run(program);
  });
});
