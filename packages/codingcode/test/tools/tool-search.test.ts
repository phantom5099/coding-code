import { describe, it, expect } from 'vitest';
import { createToolSearchTool } from '../../src/tools/domains/self/tool-search.js';

describe('createToolSearchTool', () => {
  it('returns loaded tool list when matches found', async () => {
    const tool = createToolSearchTool({
      search: (_sessionId: string, _query: string) => [
        { name: 'todo_write', shortDescription: 'Write tasks' },
      ],
      markLoaded: () => {},
    });

    const result = await tool.execute({ query: 'todo' }, { sessionId: 'test-agent' });
    expect(result).toContain('Loaded 1 tool(s)');
    expect(result).toContain('todo_write');
  });

  it('returns no-match message when no hits', async () => {
    const tool = createToolSearchTool({
      search: () => [],
      markLoaded: () => {},
    });

    const result = await tool.execute({ query: 'zzznonexistent' }, { sessionId: 'test-agent' });
    expect(result).toBe('No deferred tools matched "zzznonexistent".');
  });

  it('throws if sessionId is missing', async () => {
    const tool = createToolSearchTool({ search: () => [], markLoaded: () => {} });
    await expect(tool.execute({ query: 'anything' }, {})).rejects.toThrow(
      'tool_search requires sessionId'
    );
  });

  it('each tool instance uses its own svc closure', async () => {
    const tool1 = createToolSearchTool({
      search: () => [{ name: 'tool_a' }],
      markLoaded: () => {},
    });
    const tool2 = createToolSearchTool({
      search: () => [{ name: 'tool_b' }],
      markLoaded: () => {},
    });

    const r1 = await tool1.execute({ query: 'x' }, { sessionId: 'a' });
    const r2 = await tool2.execute({ query: 'x' }, { sessionId: 'a' });

    expect(r1).toContain('tool_a');
    expect(r2).toContain('tool_b');
  });
});
