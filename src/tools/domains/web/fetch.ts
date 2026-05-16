import { z } from 'zod';
import type { ToolDefinition } from '../../types';

export const webFetchTool: ToolDefinition = {
  name: 'fetch_url',
  description:
    'Fetch content from a URL and return its text. Use this to read API documentation, web pages, or any online resource. Supports GET requests only.',
  parameters: z.object({
    url: z.string().url().describe('The URL to fetch (must be a valid absolute URL)'),
    max_length: z
      .number()
      .int()
      .min(1)
      .max(500_000)
      .default(100_000)
      .describe('Maximum characters to return (default 100k, max 500k)'),
  }),
  schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to fetch (must be a valid absolute URL)' },
      max_length: { type: 'integer', minimum: 1, maximum: 500000, default: 100000 },
    },
    required: ['url'],
  },
  execute: async (args: unknown) => {
    const { url, max_length } = args as any;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'coding-agent/1.0',
          Accept: 'text/html,application/json,text/plain,*/*',
        },
        redirect: 'follow',
      });

      if (!response.ok) {
        return `HTTP ${response.status} ${response.statusText}: Failed to fetch ${url}`;
      }

      const contentType = response.headers.get('content-type') || '';
      const text = await response.text();
      const truncated =
        text.length > max_length
          ? text.slice(0, max_length) + `\n\n... (truncated, original ${text.length} chars, showing first ${max_length})`
          : text;

      return [
        `URL: ${url}`,
        `Status: ${response.status} ${response.statusText}`,
        `Content-Type: ${contentType}`,
        `Size: ${text.length} chars`,
        `---`,
        truncated,
      ].join('\n');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error fetching ${url}: ${message}`;
    } finally {
      clearTimeout(timer);
    }
  },
};
