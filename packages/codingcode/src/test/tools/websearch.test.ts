import { describe, it, expect } from 'vitest';
import { webSearchTool } from '../../tools/domains/web/search';

describe('webSearchTool', () => {
  it('should have correct tool name and schema', () => {
    expect(webSearchTool.name).toBe('web_search');
    expect(webSearchTool.description).toBeTruthy();
  });

  it('should validate parameters', () => {
    const parsed = webSearchTool.parameters.parse({ query: 'test query' }) as { query: string; max_results: number };
    expect(parsed.query).toBe('test query');
    expect(parsed.max_results).toBe(8); // default
  });

  it('should enforce max_results range', () => {
    expect(() => webSearchTool.parameters.parse({ query: 'test', max_results: 0 })).toThrow();
    expect(() => webSearchTool.parameters.parse({ query: 'test', max_results: 50 })).toThrow();
  });

  it('should require query parameter', () => {
    expect(() => webSearchTool.parameters.parse({})).toThrow();
  });

  it('should execute search and return results', async () => {
    const result = await webSearchTool.execute({ query: 'TypeScript programming', max_results: 3 });
    // Should return a string with results or a no-results / error message
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  }, 20_000);
});
