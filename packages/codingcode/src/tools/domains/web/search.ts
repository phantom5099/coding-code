import { z } from 'zod';
import type { ToolDefinition, ToolExecCtx } from '../../types';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate',
};

/**
 * 通过 cn.bing.com 搜索（国内可用，免费，无需 API Key）
 */
async function searchBing(
  query: string,
  maxResults: number,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  const url = `https://cn.bing.com/search?q=${encodeURIComponent(query)}&count=${maxResults}&setlang=zh-CN`;
  const response = await fetch(url, {
    signal,
    headers: BROWSER_HEADERS,
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Bing HTTP ${response.status}`);
  }

  const html = await response.text();
  return parseBingHtml(html, maxResults);
}

/**
 * 解析 Bing 搜索结果 HTML
 */
export function parseBingHtml(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  // Bing 结果在 <li class="b_algo" ...> 中（可能有其他属性如 data-id）
  const parts = html.split(/<li class="b_algo"/i);

  for (let i = 1; i < parts.length && results.length < maxResults; i++) {
    const block = parts[i];
    if (!block) continue;

    // 截取到 </li> 或下一个 <li（防止跨块匹配）
    const endIdx = block.indexOf('</li>');
    const blockContent = endIdx !== -1 ? block.substring(0, endIdx) : block;

    // 标题和链接在 <h2><a href="...">...</a></h2>
    const titleMatch = blockContent.match(/<h2[^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    // 摘要在 class="b_caption" 的 <p> 中，或 b_lineclamp 的 <p> 中
    const snippetMatch =
      blockContent.match(/class="b_caption[^"]*"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i) ||
      blockContent.match(/<p[^>]*class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i);

    if (!titleMatch) continue;

    const url = titleMatch[1]?.replace(/&amp;/g, '&').trim() || '';
    const title = titleMatch[2]?.replace(/<[^>]+>/g, '').trim() || '';
    const snippet = snippetMatch?.[1]?.replace(/<[^>]+>/g, '').trim() || '';

    if (title && url) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}

/**
 * 通过百度搜索（国内 fallback）
 */
async function searchBaidu(
  query: string,
  maxResults: number,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  const url = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&rn=${maxResults}`;
  const response = await fetch(url, {
    signal,
    headers: {
      ...BROWSER_HEADERS,
      Referer: 'https://www.baidu.com/',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Baidu HTTP ${response.status}`);
  }

  const html = await response.text();
  return parseBaiduHtml(html, maxResults);
}

/**
 * 解析百度搜索结果 HTML
 */
export function parseBaiduHtml(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  // 百度结果在 <div class="result c-container"> 或 <div class="c-container new-pmd">
  const containerBlocks = html.split(/class="[^"]*c-container[^"]*"/);

  for (let i = 1; i < containerBlocks.length && results.length < maxResults; i++) {
    const block = containerBlocks[i];
    if (!block) continue;

    // 标题在 <h3> 内的 <a> 中
    const titleMatch = block.match(/<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    // 摘要在 class 含 content-right 或 c-span-last 的 <span> 中，或 <div class="c-abstract">
    const snippetMatch =
      block.match(/class="c-abstract[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)>/i) ||
      block.match(/class="content-right[^"]*"[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i) ||
      block.match(/<span class="[^"]*content-right[^"]*"[^>]*>([\s\S]*?)<\/span>/i);

    if (!titleMatch) continue;

    const url = titleMatch[1]?.replace(/&amp;/g, '&').trim() || '';
    const title = titleMatch[2]?.replace(/<[^>]+>/g, '').trim() || '';
    const snippet = snippetMatch?.[1]?.replace(/<[^>]+>/g, '').trim() || '';

    // 过滤百度内部链接
    if (title && url && !url.startsWith('/') && !url.startsWith('#')) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}

export const webSearchTool: ToolDefinition = {
  name: 'web_search',
  description:
    'Search the web and return results with titles, URLs, and snippets. Use this when you need up-to-date information or to find documentation, references, or answers beyond your knowledge cutoff.',
  parameters: z.object({
    query: z.string().describe('The search query string'),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(8)
      .describe('Maximum number of results to return'),
  }),
  execute: async (args: unknown, _ctx?: ToolExecCtx) => {
    const { query, max_results } = args as { query: string; max_results: number };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);

    try {
      // 搜索引擎优先级：Bing(cn) → 百度
      const engines = [searchBing, searchBaidu];

      let lastError = '';
      for (const engine of engines) {
        try {
          const results = await engine(query, max_results, controller.signal);
          if (results.length > 0) {
            return results
              .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet || '(no snippet)'}`)
              .join('\n\n');
          }
        } catch (err: unknown) {
          lastError = err instanceof Error ? err.message : String(err);
        }
      }

      return `No results found for "${query}".${lastError ? ` Last error: ${lastError}` : ''}`;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return `Search error for "${query}": ${message}`;
    } finally {
      clearTimeout(timer);
    }
  },
};
