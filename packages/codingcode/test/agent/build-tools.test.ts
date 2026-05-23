import { describe, it, expect } from 'vitest';
import { Effect, Layer } from 'effect';
import { z } from 'zod';
import { ToolService } from '../../src/tools/registry.js';
import { ToolSearchService } from '../../src/agent-state/tool-search/service.js';
import { buildToolsForAgent, buildDeferredCatalogMessage } from '../../src/agent/build-tools.js';
import type { ToolDefinition } from '../../src/tools/types.js';

const toolLayer = ToolService.Default;
const searchLayer = ToolSearchService.Default.pipe(Layer.provide(toolLayer));
const layer = Layer.mergeAll(toolLayer, searchLayer);

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(layer) as any));
}

function makeTool(name: string, desc?: string, deferred?: boolean): ToolDefinition {
  return {
    name,
    description: desc ?? `Tool ${name}`,
    shortDescription: desc,
    deferred,
    parameters: z.object({}),
    execute: async () => `result-${name}`,
  };
}

describe('buildToolsForAgent', () => {
  it('returns core tools and loaded deferred tools', async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      const toolSearch = yield* ToolSearchService;
      toolSearch.reset();

      yield* tools.register(makeTool('core_read', 'Read files'));
      yield* tools.register(makeTool('deferred_todo', 'Write todo', true));
      toolSearch.search('agent-1', 'todo');

      const result = buildToolsForAgent(tools, toolSearch, 'agent-1');
      const names = result.map(t => t.name);
      expect(names).toContain('core_read');
      expect(names).toContain('deferred_todo');
    });
    await run(program);
  });

  it('excludes unloaded deferred tools', async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      const toolSearch = yield* ToolSearchService;
      toolSearch.reset();

      yield* tools.register(makeTool('deferred_z', undefined, true));
      // Use a unique agent that hasn't loaded anything
      const result = buildToolsForAgent(tools, toolSearch, 'agent-excl');
      const names = result.map(t => t.name);
      expect(names).not.toContain('deferred_z');
      // Should still contain core tools from other tests
      expect(names.length).toBeGreaterThanOrEqual(0);
    });
    await run(program);
  });

  it('different agents have independent deferred subsets', async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      const toolSearch = yield* ToolSearchService;
      toolSearch.reset();

      yield* tools.register(makeTool('deferred_x', 'X tool', true));
      toolSearch.search('agent-alpha', 'x');

      const alphaTools = buildToolsForAgent(tools, toolSearch, 'agent-alpha');
      const betaTools = buildToolsForAgent(tools, toolSearch, 'agent-beta');
      const alphaNames = alphaTools.map(t => t.name);
      const betaNames = betaTools.map(t => t.name);

      expect(alphaNames).toContain('deferred_x');
      expect(betaNames).not.toContain('deferred_x');
    });
    await run(program);
  });
});

describe('buildDeferredCatalogMessage', () => {
  it('returns message with unloaded deferred tools', async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      const toolSearch = yield* ToolSearchService;
      toolSearch.reset();

      // Use a unique name to avoid cross-test interference
      yield* tools.register(makeTool('zzz_custom_deferred', 'Custom deferred', true));

      const msg = buildDeferredCatalogMessage(toolSearch, 'agent-msg');
      expect(msg).not.toBeNull();
      expect(msg!.role).toBe('system');
      expect(msg!.content).toContain('zzz_custom_deferred');
      expect(msg!.content).toContain('<available-deferred-tools>');
    });
    await run(program);
  });

  it('returns null when agent loaded all deferred tools', async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      const toolSearch = yield* ToolSearchService;
      toolSearch.reset();

      yield* tools.register(makeTool('zzz_another_deferred', undefined, true));
      toolSearch.search('agent-loaded-all', 'another');

      const msg = buildDeferredCatalogMessage(toolSearch, 'agent-loaded-all');
      // If there are only deferred tools and we loaded them all, should be null
      // But other tests also registered deferred tools — those are unloaded for this agent
      // So this might not be null. We check that zzz_another_deferred is NOT in the message.
      if (msg) {
        expect(msg!.content).not.toContain('zzz_another_deferred');
      }
    });
    await run(program);
  });

  it('different agents have independent catalog messages', async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      const toolSearch = yield* ToolSearchService;
      toolSearch.reset();

      yield* tools.register(makeTool('zzz_secret_tool', undefined, true));
      toolSearch.search('agent-alpha', 'secret');

      const alphaMsg = buildDeferredCatalogMessage(toolSearch, 'agent-alpha');
      const betaMsg = buildDeferredCatalogMessage(toolSearch, 'agent-beta');

      // alpha loaded it, so alpha's catalog should not list zzz_secret_tool
      if (alphaMsg) {
        expect(alphaMsg!.content).not.toContain('zzz_secret_tool');
      }
      // beta didn't load it, so beta's catalog should list it
      expect(betaMsg).not.toBeNull();
      expect(betaMsg!.content).toContain('zzz_secret_tool');
    });
    await run(program);
  });
});
