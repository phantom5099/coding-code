import { describe, it, expect, beforeEach } from 'vitest';
import { toolSearchTool, bindToolSearchService } from '../../../src/tools/domains/agent-state/tool-search.js';

beforeEach(() => {
  // Reset the binding so tests are independent
  (bindToolSearchService as any)(null);
});

describe('tool_search tool', () => {
  it('returns loaded tool list when matches found', async () => {
    bindToolSearchService({
      search: (_agentId: string, _query: string) => [
        { name: 'todo_write', shortDescription: 'Write tasks' },
      ],
    });

    const result = await toolSearchTool.execute(
      { query: 'todo' },
      { agentId: 'test-agent' },
    );
    expect(result).toContain('Loaded 1 tool(s)');
    expect(result).toContain('todo_write');
  });

  it('returns no-match message when no hits', async () => {
    bindToolSearchService({
      search: () => [],
    });

    const result = await toolSearchTool.execute(
      { query: 'zzznonexistent' },
      { agentId: 'test-agent' },
    );
    expect(result).toBe('No deferred tools matched "zzznonexistent".');
  });

  it('throws if agentId is missing', async () => {
    bindToolSearchService({ search: () => [] });
    await expect(
      toolSearchTool.execute({ query: 'anything' }, {}),
    ).rejects.toThrow('tool_search requires agentId');
  });

  it('throws if service not bound', async () => {
    await expect(
      toolSearchTool.execute({ query: 'anything' }, { agentId: 'x' }),
    ).rejects.toThrow('tool_search service not bound');
  });
});
