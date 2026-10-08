import type { Effect } from 'effect';
import type { AgentError } from '../util/error.js';

export interface McpServerConfig {
  name: string;
  /** 开关：false 表示禁用。缺省（undefined）等同启用 */
  enabled?: boolean;
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

/** MCP 远端工具的纯数据描述：zod schema 与 SDK client 等机制形状由实现层持有 */
export interface McpToolSpec {
  server: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** MCP 注解 readOnlyHint；缺省 false（fail-closed） */
  readOnlyHint: boolean;
  execute(args: Record<string, unknown>): Effect.Effect<string, AgentError>;
}
