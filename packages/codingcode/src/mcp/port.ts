import { Context } from 'effect';
import type { Effect } from 'effect';
import type { McpStatus, McpToolSpec } from '../contracts/mcp.js';

export interface McpShape {
  syncConnections(projectPath: string): Effect.Effect<void>;
  connectServers(projectPath: string, sessionId: string, names: string[]): Effect.Effect<void>;
  disconnectServers(projectPath: string, sessionId: string, names: string[]): Effect.Effect<void>;
  getServerToolNames(projectPath: string, name: string): string[];
  listProjectMcpTools(projectPath: string): Effect.Effect<McpToolSpec[]>;
  status(projectPath: string): Effect.Effect<McpStatus[]>;
  disable(projectPath: string, name: string): Effect.Effect<void>;
  enable(projectPath: string, name: string): Effect.Effect<void>;
  disposeSession(sessionId: string): Effect.Effect<void>;
  disposeProject(projectPath: string): Effect.Effect<void>;
}

export class McpService extends Context.Tag('Mcp')<McpService, McpShape>() {}
