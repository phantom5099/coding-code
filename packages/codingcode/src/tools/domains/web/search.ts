import { z } from 'zod';
import type { ToolDefinition } from '../../types';

export const webSearchTool: ToolDefinition = {
  name: 'web_search',
  description:
    'Search the web and return results with titles, URLs, and snippets. Use this when you need up-to-date information or to find documentation, references, or answers beyond your knowledge cutoff.',
  parameters: z.object({
    query: z.string().describe('The search query string'),
    max_results: z.number().int().min(1).max(20).default(8).describe('Maximum number of results to return'),
  }),
  execute: async (args: unknown) => {
    const { query, max_results } = args as { query: string; max_results: number };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);

    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'coding-agent/1.0', Accept: 'text/html' },
        redirect: 'follow',
      });

      if (!response.ok) {
        return `Search failed: HTTP ${response.status} ${response.statusText}`;
      }

      const html = await response.text();
      const results = parseDuckDuckGoHtml(html).slice(0, max_results);

      if (results.length === 0) {
        return `No results found for "${query}".`;
      }

      return results
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
        .join('\n\n');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return `Search error for "${query}": ${message}`;
    } finally {
      clearTimeout(timer);
    }
  },
};

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function parseDuckDuckGoHtml(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const resultBlocks = html.split('class="result__body"');

  for (let i = 1; i < resultBlocks.length; i++) {
    const block = resultBlocks[i];
    if (!block) continue;

    const titleMatch = block.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/i);
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);

    const title = titleMatch?.[1]?.replace(/<[^>]+>/g, '').trim() || '';

    // Extract URL from the first href in the block
    const hrefMatch = block.match(/href="([^"]+)"/);
    let url = '';
    if (hrefMatch?.[1]) {
      url = hrefMatch[1].replace(/&amp;/g, '&');
      if (url.startsWith('//duckduckgo.com/l/')) {
        const uddgMatch = url.match(/uddg=([^&]+)/);
        if (uddgMatch?.[1]) {
          url = decodeURIComponent(uddgMatch[1]);
        }
      }
    }

    const snippet = snippetMatch?.[1]?.replace(/<[^>]+>/g, '').trim() || '';

    if (title) {
      results.push({ title, url: url || '(no url)', snippet: snippet || '(no snippet)' });
    }
  }

  return results;
}
