import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createToolCatalog } from '../../src/tools/catalog.js';

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
    const mcp = {
      name: 'mcp_thing',
      description: 'a thing',
      parameters: z.object({}),
      execute: () => ({}) as any,
    };
    const { tools, lookup } = createToolCatalog(['read_file'], [mcp]);
    expect(tools.map((t) => t.name)).toEqual(['read_file', 'mcp_thing']);
    expect(lookup('mcp_thing')?.name).toBe('mcp_thing');
  });
});
