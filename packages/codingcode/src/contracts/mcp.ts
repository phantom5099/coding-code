import type { Effect } from 'effect';
import type { AgentError } from '../core/error.js';

export interface McpServerConfig {
  name: string;
  /** stdio: executable command */
  command?: string;
  /** stdio: command arguments */
  args?: string[];
  /** stdio: environment variables */
  env?: Record<string, string>;
  /** StreamableHTTP: server URL */
  url?: string;
  /** StreamableHTTP: request headers */
  headers?: Record<string, string>;
  /** Max concurrent tool calls to this server (default 3) */
  concurrency?: number;
  /** Auto-reconnect on disconnect (default true) */
  autoReconnect?: boolean;
}

export interface McpStatus {
  name: string;
  connected: boolean;
  disabled: boolean;
  toolCount: number;
  transport: 'stdio' | 'http';
  reconnectAttempts: number;
  leaseCount: number;
}

/** MCP 远端工具的纯数据描述：zod schema 与 SDK client 等机制形状由实现层持有 */
export interface McpToolSpec {
  server: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(args: Record<string, unknown>): Effect.Effect<string, AgentError>;
}
