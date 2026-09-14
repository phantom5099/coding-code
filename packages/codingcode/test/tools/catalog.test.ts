import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { createToolCatalog } from '../../src/tools/catalog.js';
import type { McpToolSpec } from '../../src/contracts/mcp.js';

const BUILD_NAMES = [
  'read_file',
  'write_file',
  'edit_file',
  'execute_command',
  'search_code',
  'search_files',
  'fetch_url',
  'web_search',
  'todo_write',
  'dispatch_agent',
];

describe('createToolCatalog', () => {
  it('assembles tools by name in the order given', () => {
    const { tools } = createToolCatalog(BUILD_NAMES);
    expect(tools.map((t) => t.name)).toEqual(BUILD_NAMES);
  });

  it('excludes tools not present in the name list', () => {
    const { tools } = createToolCatalog(['read_file', 'submit_plan']);
    const names = tools.map((t) => t.name);
    expect(names).toEqual(['read_file', 'submit_plan']);
    expect(names).not.toContain('write_file');
    expect(names).not.toContain('execute_command');
  });

  it('throws on an unknown tool name', () => {
    expect(() => createToolCatalog(['nope'])).toThrow(/Unknown tool/);
  });

  it('lookup resolves registered tools by name only', () => {
    const { lookup } = createToolCatalog(BUILD_NAMES);
    expect(lookup('write_file')?.name).toBe('write_file');
    expect(lookup('submit_plan')).toBeUndefined();
  });

  it('merges dynamic MCP tools into the catalog', () => {
    const spec: McpToolSpec = {
      server: 'srv',
      name: 'thing',
      description: 'a thing',
      inputSchema: {},
      execute: () => Effect.succeed('ok'),
    };
    const { tools, lookup } = createToolCatalog(['read_file'], [spec]);
    expect(tools.map((t) => t.name)).toEqual(['read_file', 'srv:thing']);
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
      execute: () => Effect.succeed('ok'),
    };
    const { lookup } = createToolCatalog([], [spec]);
    const tool = lookup('srv:thing')!;
    expect(() => tool.parse({})).toThrow();
    expect(tool.parse({ text: 'hello' })).toEqual({ text: 'hello' });
  });

  it('forwards MCP spec execute into the tool runner', async () => {
    const spec: McpToolSpec = {
      server: 'srv',
      name: 'thing',
      description: '',
      inputSchema: {},
      execute: (args) => Effect.succeed(`called:${String(args.n)}`),
    };
    const { lookup } = createToolCatalog([], [spec]);
    const tool = lookup('srv:thing')!;
    const out = await Effect.runPromise(tool.execute({ n: 1 }) as Effect.Effect<string, never>);
    expect(out).toBe('called:1');
  });
});
