import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { ToolService } from './registry.js';
import { AppLayer } from '../layer.js';
import type { ToolDefinition } from './types.js';
import { z } from 'zod';

function makeTool(name: string): ToolDefinition {
  return {
    name,
    description: `Tool ${name}`,
    parameters: z.object({}),
    schema: { type: 'object' },
    execute: async () => `result-${name}`,
  };
}

function runWithLayer<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(AppLayer) as any));
}

describe('ToolService', () => {
  it('should register a tool', async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      yield* tools.register(makeTool('test_tool'));
      const t = yield* tools.get('test_tool');
      return t.name;
    });
    const name = await runWithLayer(program);
    expect(name).toBe('test_tool');
  });

  it('should skip duplicate tool registration (built-in priority)', async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      yield* tools.register(makeTool('dup_tool'));
      yield* tools.register(makeTool('dup_tool')); // duplicate, should be skipped
      const desc = yield* tools.describeAll();
      return desc.filter((d) => d.name === 'dup_tool').length;
    });
    const count = await runWithLayer(program);
    expect(count).toBe(1);
  });

  it('should fail get with ToolNotFound for unknown tool', async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      return yield* tools.get('nonexistent');
    });
    const result = await Effect.runPromise(
      program.pipe(Effect.provide(AppLayer), Effect.either) as any,
    );
    expect(result._tag).toBe('Left');
  });

  it('should describeAll return all registered tools', async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      yield* tools.register(makeTool('a'));
      yield* tools.register(makeTool('b'));
      const desc = yield* tools.describeAll();
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
      const filtered = yield* tools.filter(['keep']);
      return filtered.length;
    });
    const count = await runWithLayer(program);
    expect(count).toBe(1);
  });

  it('getSync should work for non-Effect callers', async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      yield* tools.register(makeTool('sync_tool'));
      return tools.getSync('sync_tool');
    });
    const result = await runWithLayer(program);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.name).toBe('sync_tool');
  });
});
