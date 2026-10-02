import { Context } from 'effect';
import type { Effect } from 'effect';
import type { FrameBody } from '../contracts/frame.js';
import type { ProfileName } from '../contracts/types.js';
import type { PermissionMode } from '../contracts/permission.js';
import type { AgentError } from '../core/error.js';

export interface RunTurnOptions {
  sessionId?: string;
  cwd: string;
  signal?: AbortSignal;
  permissionMode?: PermissionMode;
  model: string;
  activeProfile?: ProfileName;
  parentSessionId?: string;
  agentName?: string;
  systemPrompt?: string;
}

export interface AgentShape {
  runTurn(
    input: string,
    opts: RunTurnOptions
  ): Effect.Effect<
    {
      stream: AsyncGenerator<FrameBody>;
      sessionId: string;
    },
    AgentError
  >;
}

export class AgentService extends Context.Tag('AgentService')<AgentService, AgentShape>() {}

export interface ToolEnv {
  provide<R, E, A>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, never>;
}

export class ToolEnvPort extends Context.Tag('AgentToolEnvPort')<ToolEnvPort, {
  getToolEnv(): Effect.Effect<ToolEnv>;
}>() {}
