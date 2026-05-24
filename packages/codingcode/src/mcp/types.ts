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
}
