import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { createToolCatalog } from '@codingcode/tool';
import type { McpToolSpec } from '@codingcode/mcp';
import { ALL_BUILTIN_TOOLS } from '../helpers/builtin-tools.js';

const BUILTIN_NAMES = ALL_BUILTIN_TOOLS.map((t) => t.name);

describe('createToolCatalog', () => {
  it('assembles the complete built-in catalog', () => {
    const { tools } = createToolCatalog(ALL_BUILTIN_TOOLS);
    expect(tools.map((t) => t.name)).toEqual(BUILTIN_NAMES);
  });

  it('lookup resolves registered tools by name only', () => {
    const { lookup } = createToolCatalog(ALL_BUILTIN_TOOLS);
    expect(lookup('write_file')?.name).toBe('write_file');
    expect(lookup('unknown_tool')).toBeUndefined();
  });

  it('merges dynamic MCP tools into the catalog', () => {
    const spec: McpToolSpec = {
      server: 'srv',
      name: 'thing',
      description: 'a thing',
      inputSchema: {},
      readOnlyHint: false,
      execute: () => Effect.succeed('ok'),
    };
    const { tools, lookup } = createToolCatalog(ALL_BUILTIN_TOOLS, [spec]);
    expect(tools.map((t) => t.name)).toEqual([...BUILTIN_NAMES, 'srv:thing']);
    expect(lookup('srv:thing')?.name).toBe('srv:thing');
  });

  it('turns an MCP spec JSON Schema into the tool parameters schema', () => {
    const spec: McpToolSpec = {
      server: 'srv',
      name: 'thing',
      description: '',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
      readOnlyHint: false,
      execute: () => Effect.succeed('ok'),
    };
    const { lookup } = createToolCatalog(ALL_BUILTIN_TOOLS, [spec]);
    const tool = lookup('srv:thing')!;
    expect(() => tool.parse({})).toThrow();
    expect(tool.parse({ text: 'hello' })).toEqual({ text: 'hello' });
  });

  it('rejects direct MCP execution without a sandbox policy', async () => {
    const spec: McpToolSpec = {
      server: 'srv',
      name: 'thing',
      description: '',
      inputSchema: {},
      readOnlyHint: false,
      execute: (args) => Effect.succeed(`called:${String(args.n)}`),
    };
    const { lookup } = createToolCatalog(ALL_BUILTIN_TOOLS, [spec]);
    const tool = lookup('srv:thing')!;
    await expect(
      Effect.runPromise(tool.execute({ n: 1 }, { model: 'test-model' }) as Effect.Effect<string, never>)
    ).rejects.toThrow(/SANDBOX_POLICY_DENIED/);
  });

  it('forwards MCP execution when a sandbox policy is supplied', async () => {
    const spec: McpToolSpec = {
      server: 'srv',
      name: 'thing',
      description: '',
      inputSchema: {},
      readOnlyHint: false,
      execute: (args) => Effect.succeed(`called:${String(args.n)}`),
    };
    const { lookup } = createToolCatalog(ALL_BUILTIN_TOOLS, [spec]);
    const tool = lookup('srv:thing')!;
    const out = await Effect.runPromise(
      tool.execute(
        { n: 1 },
        {
          model: 'test-model',
          sandboxPolicy: {
            mode: 'unrestricted',
            workspaceRoot: process.cwd(),
            additionalWritableRoots: [],
            network: { mode: 'unrestricted', hosts: [], ports: [] },
            sessionId: 'test-session',
            enforcement: 'disabled',
            fingerprint: 'test',
          },
        }
      ) as Effect.Effect<string, never>
    );
    expect(out).toBe('called:1');
  });
});
