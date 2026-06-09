import { describe, it, expect } from 'vitest';
import { webSearchTool, parseBingHtml, parseBaiduHtml } from '../../src/tools/domains/web/search.js';

describe('webSearchTool', () => {
  it('should have correct tool name and schema', () => {
    expect(webSearchTool.name).toBe('web_search');
    expect(webSearchTool.description).toBeTruthy();
  });

  it('should validate parameters', () => {
    const parsed = webSearchTool.parameters.parse({ query: 'test query' }) as {
      query: string;
      max_results: number;
    };
    expect(parsed.query).toBe('test query');
    expect(parsed.max_results).toBe(8);
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
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    // 应该返回编号格式的结果，而不是错误信息
    expect(result).not.toContain('Search error');
  }, 20_000);

  it('should support Chinese query', async () => {
    const result = await webSearchTool.execute({ query: '自主AI agent平台', max_results: 3 });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toContain('Search error');
  }, 20_000);
});

describe('parseBingHtml', () => {
  it('should parse Bing HTML results correctly', () => {
    const html = `
      <li class="b_algo">
        <h2><a href="https://example.com/page1">Example Title 1</a></h2>
        <div class="b_caption"><p>Snippet text 1</p></div>
      </li>
      <li class="b_algo">
        <h2><a href="https://example.com/page2">Example Title 2</a></h2>
        <div class="b_caption"><p>Snippet text 2</p></div>
      </li>
    `;

    const results = parseBingHtml(html, 10);
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe('Example Title 1');
    expect(results[0].url).toBe('https://example.com/page1');
    expect(results[0].snippet).toBe('Snippet text 1');
  });

  it('should respect maxResults limit', () => {
    const html = `
      <li class="b_algo"><h2><a href="https://example.com/1">Title 1</a></h2></li>
      <li class="b_algo"><h2><a href="https://example.com/2">Title 2</a></h2></li>
      <li class="b_algo"><h2><a href="https://example.com/3">Title 3</a></h2></li>
    `;

    const results = parseBingHtml(html, 2);
    expect(results).toHaveLength(2);
  });

  it('should return empty array for HTML with no results', () => {
    const html = '<html><body>No results found</body></html>';
    const results = parseBingHtml(html, 10);
    expect(results).toHaveLength(0);
  });

  it('should strip HTML tags from titles and snippets', () => {
    const html = `
      <li class="b_algo">
        <h2><a href="https://example.com/page1"><strong>Bold</strong> Title</a></h2>
        <div class="b_caption"><p>Text with <em>emphasis</em></p></div>
      </li>
    `;

    const results = parseBingHtml(html, 10);
    expect(results[0].title).toBe('Bold Title');
    expect(results[0].snippet).toBe('Text with emphasis');
  });
});

describe('parseBaiduHtml', () => {
  it('should parse Baidu HTML results correctly', () => {
    const html = `
      <div class="result c-container">
        <h3><a href="https://example.com/page1">百度结果1</a></h3>
        <span class="content-right">摘要文本1</span>
      </div>
      <div class="result c-container">
        <h3><a href="https://example.com/page2">百度结果2</a></h3>
        <span class="content-right">摘要文本2</span>
      </div>
    `;

    const results = parseBaiduHtml(html, 10);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('should filter out Baidu internal links', () => {
    const html = `
      <div class="result c-container">
        <h3><a href="/link?url=xxx">内部链接</a></h3>
      </div>
      <div class="result c-container">
        <h3><a href="https://example.com/real">真实链接</a></h3>
      </div>
    `;

    const results = parseBaiduHtml(html, 10);
    expect(results.every((r) => !r.url.startsWith('/'))).toBe(true);
  });

  it('should return empty array for HTML with no results', () => {
    const html = '<html><body>没有结果</body></html>';
    const results = parseBaiduHtml(html, 10);
    expect(results).toHaveLength(0);
  });
});
