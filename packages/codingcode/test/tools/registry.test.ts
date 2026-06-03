import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { ToolService } from '../../src/tools/registry.js';
import { AppLayer } from '../../src/layer.js';
import type { ToolDefinition } from '../../src/tools/types.js';
import { z } from 'zod';

function makeTool(name: string, deferred?: boolean): ToolDefinition {
  return {
    name,
    description: `Tool ${name}`,
    deferred,
    parameters: z.object({}),
    execute: async () => `result-${name}`,
  };
}

function runWithLayer<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(AppLayer) as any));
}

describe('ToolService', () => {
  it('should register and get a tool', async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      yield* tools.register(makeTool('test_tool'));
      const result = tools.get('test_tool');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.name).toBe('test_tool');
    });
    await runWithLayer(program);
  });

  it('should skip duplicate tool registration (built-in priority)', async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      yield* tools.register(makeTool('dup_tool'));
      yield* tools.register(makeTool('dup_tool'));
      const desc = tools.describeAll();
      return desc.filter((d) => d.name === 'dup_tool').length;
    });
    const count = await runWithLayer(program);
    expect(count).toBe(1);
  });

  it('should return error for unknown tool', async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      const result = tools.get('nonexistent');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('TOOL_NOT_FOUND');
    });
    await runWithLayer(program);
  });

  it('should describeAll return all registered tools', async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      yield* tools.register(makeTool('a'));
      yield* tools.register(makeTool('b'));
      const desc = tools.describeAll();
      return desc.length;
    });
    const count = await runWithLayer(program);
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('should filter return only requested tools', async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      yield* tools.register(makeTool('keep'));
      yield* tools.register(makeTool('skip'));
      const filtered = tools.filter(['keep']);
      return filtered.length;
    });
    const count = await runWithLayer(program);
    expect(count).toBe(1);
  });

  it('get is sync and returns Result', async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      yield* tools.register(makeTool('sync_tool'));
      const result = tools.get('sync_tool');
      return result;
    });
    const result = await runWithLayer(program);
    expect(result.ok).toBe(true);
  });

  it('allDeferred returns only deferred tools', async () => {
    const program = Effect.gen(function* () {
      const svc = yield* ToolService;
      yield* svc.register(makeTool('core_a'));
      yield* svc.register(makeTool('deferred_b', true));
      yield* svc.register(makeTool('core_c'));
      yield* svc.register(makeTool('deferred_d', true));
      const deferred = svc.allDeferred();
      expect(deferred).toHaveLength(2);
      expect(deferred.every((t) => t.deferred === true)).toBe(true);
      expect(deferred.map((t) => t.name).sort()).toEqual(['deferred_b', 'deferred_d']);
    });
    await runWithLayer(program);
  });

  it('allCore returns only non-deferred tools', async () => {
    const program = Effect.gen(function* () {
      const svc = yield* ToolService;
      yield* svc.register(makeTool('core_a'));
      yield* svc.register(makeTool('deferred_b', true));
      yield* svc.register(makeTool('core_c'));
      const core = svc.allCore();
      expect(core.every((t) => t.deferred !== true)).toBe(true);
      const names = core.map((t) => t.name);
      expect(names).toContain('core_a');
      expect(names).toContain('core_c');
      expect(names).not.toContain('deferred_b');
    });
    await runWithLayer(program);
  });

  it('getDef returns undefined for unknown tool', async () => {
    const program = Effect.gen(function* () {
      const svc = yield* ToolService;
      expect(svc.getDef('nonexistent')).toBeUndefined();
    });
    await runWithLayer(program);
  });

  it('getDef returns tool by name', async () => {
    const program = Effect.gen(function* () {
      const svc = yield* ToolService;
      yield* svc.register(makeTool('some_tool'));
      const def = svc.getDef('some_tool');
      expect(def).toBeDefined();
      expect(def!.name).toBe('some_tool');
    });
    await runWithLayer(program);
  });

  it('unregister removes the tool', async () => {
    const program = Effect.gen(function* () {
      const svc = yield* ToolService;
      yield* svc.register(makeTool('to_remove'));
      expect(svc.getDef('to_remove')).toBeDefined();
      yield* svc.unregister('to_remove');
      expect(svc.getDef('to_remove')).toBeUndefined();
      const result = svc.get('to_remove');
      expect(result.ok).toBe(false);
    });
    await runWithLayer(program);
  });

  it('unregister on unknown tool is a no-op', async () => {
    const program = Effect.gen(function* () {
      const svc = yield* ToolService;
      yield* svc.unregister('does_not_exist');
    });
    await runWithLayer(program);
  });
});
