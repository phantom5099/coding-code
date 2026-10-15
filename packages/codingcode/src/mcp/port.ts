import { Context } from 'effect';
import type { Effect } from 'effect';
import type { McpToolSpec, McpServerConfig, McpServerEntry, McpConfigOutcome } from './types.js';

export interface McpShape {
  syncConnections(projectPath: string): Effect.Effect<void>;
  listProjectMcpTools(projectPath: string): Effect.Effect<McpToolSpec[]>;

  /** projectPath 省略(undefined) = 全局层，模块内部经 getGlobalDir() 定位 */
  listServers(projectPath?: string): Effect.Effect<McpServerEntry[]>;
  createServer(
    projectPath: string | undefined,
    server: McpServerConfig
  ): Effect.Effect<McpConfigOutcome>;
  updateServer(
    projectPath: string | undefined,
    name: string,
    server: McpServerConfig
  ): Effect.Effect<McpConfigOutcome>;
  deleteServer(projectPath: string | undefined, name: string): Effect.Effect<McpConfigOutcome>;
  setServerEnabled(
    projectPath: string | undefined,
    name: string,
    enabled: boolean
  ): Effect.Effect<void>;
}

export class McpService extends Context.Tag('Mcp')<McpService, McpShape>() {}
