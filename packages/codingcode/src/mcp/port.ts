import { Context } from 'effect';
import type { Effect } from 'effect';
import type { McpToolSpec } from './types.js';

export interface McpShape {
  syncConnections(projectPath: string): Effect.Effect<void>;
  listProjectMcpTools(projectPath: string): Effect.Effect<McpToolSpec[]>;
}

export class McpService extends Context.Tag('Mcp')<McpService, McpShape>() {}
