import { z } from 'zod';
import { Effect } from 'effect';
import { AgentError } from '@codingcode/util';
import { defineTool } from '@codingcode/tool';
import { assertNetworkTarget, parseNetworkTarget } from '@codingcode/sandbox';

export const webFetchTool = defineTool({
  name: 'fetch_url',
  concurrencySafe: true,
  approval: { action: 'network', requiresConfirmation: true },
  describeOperation: (args) => {
    try {
      const target = parseNetworkTarget(args.url ?? '');
      return {
        action: 'network',
        requiresConfirmation: true,
        network: { hosts: [target.host], ports: [target.port] },
      };
    } catch {
      return { action: 'network', requiresConfirmation: true, dangerous: ['network_unrestricted'] };
    }
  },
  description: 'Fetch content from a URL and return its text. Supports GET requests only.',
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
  execute: ({ url, max_length }, ctx) =>
    Effect.gen(function* () {
      if (!ctx?.sandboxPolicy) {
        return yield* Effect.fail(
          new AgentError('SANDBOX_NETWORK_DENIED', 'fetch_url requires a sandbox policy')
        );
      }
      yield* Effect.try({
        try: () => assertNetworkTarget(ctx.sandboxPolicy!, url),
        catch: (e) =>
          e instanceof AgentError ? e : AgentError.toolExecutionFailed('fetch_url', e),
      });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);

      const result = yield* Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(url, {
              signal: controller.signal,
              headers: {
                'User-Agent': 'coding-agent/1.0',
                Accept: 'text/html,application/json,text/plain,*/*',
              },
              redirect: 'follow',
            }),
          catch: (e) => AgentError.toolExecutionFailed('fetch_url', e),
        });

        yield* Effect.try({
          try: () => assertNetworkTarget(ctx.sandboxPolicy!, response.url),
          catch: (e) =>
            e instanceof AgentError ? e : AgentError.toolExecutionFailed('fetch_url', e),
        });

        if (!response.ok) {
          return `HTTP ${response.status} ${response.statusText}: Failed to fetch ${url}`;
        }

        const contentType = response.headers.get('content-type') || '';
        const text = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: (e) => AgentError.toolExecutionFailed('fetch_url', e),
        });
        const truncated =
          text.length > max_length
            ? text.slice(0, max_length) +
              `\n\n... (truncated, original ${text.length} chars, showing first ${max_length})`
            : text;

        return [
          `URL: ${url}`,
          `Status: ${response.status} ${response.statusText}`,
          `Content-Type: ${contentType}`,
          `Size: ${text.length} chars`,
          `---`,
          truncated,
        ].join('\n');
      }).pipe(
        Effect.catchAll((e: AgentError) =>
          e.code.startsWith('SANDBOX_')
            ? Effect.fail(e)
            : Effect.succeed(
                `Error fetching ${url}: ${e.cause instanceof Error ? e.cause.message : String(e.cause ?? e.message)}`
              )
        )
      );

      clearTimeout(timer);
      return result;
    }),
});
