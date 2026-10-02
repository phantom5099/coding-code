import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Effect, TSemaphore, STM } from 'effect';
import type { McpServerConfig } from '../contracts/mcp.js';

/** callTool 的失败类型；导出仅为满足 d.ts 生成（模块外无 import） */
export class McpError extends Error {
  constructor(
    public readonly serverName: string,
    public readonly toolName: string,
    cause: unknown
  ) {
    super(`[MCP:${serverName}] ${toolName} failed: ${String(cause)}`);
  }
}

export class McpClient {
  private semaphore: TSemaphore.TSemaphore | null = null;
  private client: Client;
  private transport: StdioClientTransport | StreamableHTTPClientTransport;
  private reconnectAttempts = 0;
  private maxReconnect = 3;
  private destroyed = false;

  constructor(private config: McpServerConfig) {
    this.client = new Client({ name: 'codingcode', version: '1.0.0' }, { capabilities: {} });

    if (config.command) {
      this.transport = new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        env: config.env,
        stderr: 'pipe', // SDK 自动 drain
      });
    } else if (config.url) {
      this.transport = new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: config.headers
          ? { headers: config.headers as Record<string, string> }
          : undefined,
      });
    } else {
      throw new Error(`MCP server '${config.name}' must have either command or url`);
    }
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport);
    this.reconnectAttempts = 0;

    // stdio: detect process exit for reconnect
    if (this.transport instanceof StdioClientTransport) {
      // SDK's StdioClientTransport exposes _process for monitoring
      const proc = (
        this.transport as unknown as { _process?: { on: (e: string, cb: () => void) => void } }
      )._process;
      if (proc) {
        proc.on('exit', () => {
          if (!this.destroyed && this.config.autoReconnect !== false) {
            this.tryReconnect();
          }
        });
      }
    }
  }

  private async tryReconnect(): Promise<void> {
    if (this.destroyed) return;
    if (this.reconnectAttempts >= this.maxReconnect) return;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
    await new Promise((r) => setTimeout(r, delay));
    this.reconnectAttempts++;
    try {
      await this.connect();
    } catch {
      this.tryReconnect();
    }
  }

  async listTools(): Promise<
    Array<{
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
      readOnlyHint: boolean;
    }>
  > {
    const result = await this.client.listTools();
    return result.tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: (t.inputSchema as Record<string, unknown>) ?? {},
      readOnlyHint: t.annotations?.readOnlyHint ?? false,
    }));
  }

  callTool(name: string, args: Record<string, unknown>): Effect.Effect<string, McpError> {
    const self = this;
    return Effect.gen(function* () {
      // Lazy init semaphore on first call
      if (!self.semaphore) {
        self.semaphore = yield* STM.commit(TSemaphore.make(self.config.concurrency ?? 3));
      }

      return yield* TSemaphore.withPermits(
        self.semaphore,
        1
      )(
        Effect.tryPromise({
          try: async () => {
            const result = await self.client.callTool({ name, arguments: args }, undefined, {
              timeout: 60_000,
            });
            const content = result.content as Array<{ type: string; text?: string }>;
            return content
              .filter((c) => c.type === 'text')
              .map((c) => c.text ?? '')
              .join('\n');
          },
          catch: (cause) => new McpError(self.config.name, name, cause),
        })
      );
    });
  }

  async disconnect(): Promise<void> {
    this.destroyed = true;
    await this.client.close();
  }
}
