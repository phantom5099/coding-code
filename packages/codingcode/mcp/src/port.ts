import { Context } from 'effect';
import type { Effect } from 'effect';
import type { ConfigScope } from '@codingcode/util';
import type {
  CreateMcpServerCommand,
  DeleteMcpServerCommand,
  McpConfigOutcome,
  McpServerEntry,
  McpToolSpec,
  SetMcpServerEnabledCommand,
  UpdateMcpServerCommand,
} from './types.js';

export interface McpShape {
  syncConnections(projectPath: string): Effect.Effect<void>;
  listProjectMcpTools(projectPath: string): Effect.Effect<McpToolSpec[]>;

  listServers(scope: ConfigScope): Effect.Effect<McpServerEntry[]>;
  createServer(cmd: CreateMcpServerCommand): Effect.Effect<McpConfigOutcome>;
  updateServer(cmd: UpdateMcpServerCommand): Effect.Effect<McpConfigOutcome>;
  deleteServer(cmd: DeleteMcpServerCommand): Effect.Effect<McpConfigOutcome>;
  setServerEnabled(cmd: SetMcpServerEnabledCommand): Effect.Effect<void>;
}

export class McpService extends Context.Tag('Mcp')<McpService, McpShape>() {}
