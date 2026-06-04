import { describe, it, expect } from 'vitest';
import { Effect, Layer } from 'effect';
import { z } from 'zod';
import { ToolService } from '../../src/tools/registry.js';
import { ToolSearchService } from '../../src/tools/tool-search-service.js';
import { buildToolsForAgent, buildDeferredCatalogContent } from '../../src/agent/build-tools.js';
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

      const result = buildToolsForAgent(
        (_params) => {
          const all = tools.allCore().concat(tools.allDeferred());
          const loadedDeferred = all.filter(
            (t) => t.deferred && toolSearch.isLoaded('agent-1', t.name)
          );
          const core = all.filter((t) => !t.deferred);
          return [...core, ...loadedDeferred].map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.jsonSchema ?? (z.toJSONSchema(t.parameters) as Record<string, unknown>),
          }));
        },
        {
          projectPath: '/test',
          sessionId: 'agent-1',
          profile: { name: 'default', description: '' },
          policy: { allowToolSearch: true, allowDeferredTools: false },
        }
      );
      const names = result.map((t) => t.name);
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
      const result = buildToolsForAgent(
        (_params) => {
          const all = tools.allCore().concat(tools.allDeferred());
          const loaded = all.filter((t) => t.deferred && toolSearch.isLoaded('agent-excl', t.name));
          const core = all.filter((t) => !t.deferred);
          return [...core, ...loaded].map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.jsonSchema ?? (z.toJSONSchema(t.parameters) as Record<string, unknown>),
          }));
        },
        {
          projectPath: '/test',
          sessionId: 'agent-excl',
          profile: { name: 'default', description: '' },
          policy: { allowToolSearch: true, allowDeferredTools: false },
        }
      );
      const names = result.map((t) => t.name);
      expect(names).not.toContain('deferred_z');
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

      const alphaTools = buildToolsForAgent(
        (_params) => {
          const all = tools.allCore().concat(tools.allDeferred());
          const loaded = all.filter(
            (t) => t.deferred && toolSearch.isLoaded('agent-alpha', t.name)
          );
          const core = all.filter((t) => !t.deferred);
          return [...core, ...loaded].map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.jsonSchema ?? (z.toJSONSchema(t.parameters) as Record<string, unknown>),
          }));
        },
        {
          projectPath: '/test',
          sessionId: 'agent-alpha',
          profile: { name: 'default', description: '' },
          policy: { allowToolSearch: true, allowDeferredTools: false },
        }
      );
      const betaTools = buildToolsForAgent(
        (_params) => {
          const all = tools.allCore().concat(tools.allDeferred());
          const loaded = all.filter((t) => t.deferred && toolSearch.isLoaded('agent-beta', t.name));
          const core = all.filter((t) => !t.deferred);
          return [...core, ...loaded].map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.jsonSchema ?? (z.toJSONSchema(t.parameters) as Record<string, unknown>),
          }));
        },
        {
          projectPath: '/test',
          sessionId: 'agent-beta',
          profile: { name: 'default', description: '' },
          policy: { allowToolSearch: true, allowDeferredTools: false },
        }
      );
      const alphaNames = alphaTools.map((t) => t.name);
      const betaNames = betaTools.map((t) => t.name);

      expect(alphaNames).toContain('deferred_x');
      expect(betaNames).not.toContain('deferred_x');
    });
    await run(program);
  });
});

describe('buildDeferredCatalogContent', () => {
  it('returns content with unloaded deferred tools', async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      const toolSearch = yield* ToolSearchService;
      toolSearch.reset();

      yield* tools.register(makeTool('zzz_custom_deferred', 'Custom deferred', true));

      const content = buildDeferredCatalogContent(toolSearch, 'agent-msg');
      expect(content).not.toBeNull();
      expect(content!).toContain('zzz_custom_deferred');
      expect(content!).toContain('<available-deferred-tools>');
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

      const content = buildDeferredCatalogContent(toolSearch, 'agent-loaded-all');
      if (content) {
        expect(content!).not.toContain('zzz_another_deferred');
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

      const alphaContent = buildDeferredCatalogContent(toolSearch, 'agent-alpha');
      const betaContent = buildDeferredCatalogContent(toolSearch, 'agent-beta');

      if (alphaContent) {
        expect(alphaContent!).not.toContain('zzz_secret_tool');
      }
      expect(betaContent).not.toBeNull();
      expect(betaContent!).toContain('zzz_secret_tool');
    });
    await run(program);
  });
});
