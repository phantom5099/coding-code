import { Context } from 'effect';
import type { Effect } from 'effect';
import type { FrameBody } from '../contracts/frame.js';
import type { ProfileName, ToolDescription } from '../contracts/types.js';
import type { PermissionMode } from '../contracts/permission.js';
import type { ToolLookup } from '../contracts/tool.js';

export interface RunTurnOptions {
  sessionId?: string;
  cwd: string;
  signal?: AbortSignal;
  permissionMode?: PermissionMode;
  model?: string;
  activeProfile?: ProfileName;
}

export interface AgentShape {
  runTurn(
    input: string,
    opts: RunTurnOptions
  ): Effect.Effect<{
    stream: AsyncGenerator<FrameBody>;
    sessionId: string;
  }>;
}

export class AgentService extends Context.Tag('AgentService')<AgentService, AgentShape>() {}

// agent 自持的装配端口：工具执行期注入能力 + 静态工具目录装配，均不离开 agent/
export interface ToolEnv {
  provide<R, E, A>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, never>;
}

export class ToolEnvPort extends Context.Tag('AgentToolEnvPort')<ToolEnvPort, {
  getToolEnv(): Effect.Effect<ToolEnv, never, any>;
}>() {}

export interface ToolCatalog {
  tools: ToolDescription[];
  lookup: ToolLookup;
}

export class ToolCatalogPort extends Context.Tag('AgentToolCatalogPort')<ToolCatalogPort, {
  register(toolNames: readonly string[], cwd: string): Effect.Effect<ToolCatalog>;
}>() {}
