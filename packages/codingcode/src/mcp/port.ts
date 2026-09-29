import { Context } from 'effect';
import type { Effect } from 'effect';
import type { McpStatus, McpToolSpec } from '../contracts/mcp.js';

export interface McpShape {
  syncConnections(projectPath: string): Effect.Effect<void>;
  listProjectMcpTools(projectPath: string): Effect.Effect<McpToolSpec[]>;
  status(projectPath: string): Effect.Effect<McpStatus[]>;
}

export class McpService extends Context.Tag('Mcp')<McpService, McpShape>() {}
