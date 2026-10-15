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

/** 配置写操作的结果：只表达成败与原因，HTTP 语义由调用方翻译 */
export type McpConfigOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'not-found' | 'already-exists' };

/** 列表项：配置 + 归一后的 enabled 与来源标注 */
export interface McpServerEntry extends McpServerConfig {
  enabled: boolean;
  source: 'global' | 'project';
  /** 仅项目层返回；全局层不带该键 */
  hasProjectOverride?: boolean;
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
