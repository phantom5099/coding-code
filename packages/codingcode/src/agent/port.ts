import { Context } from 'effect';
import type { Effect } from 'effect';
import type { FrameBody } from '../sink/types.js';
import type { ProfileName, PermissionMode } from '../util/enums.js';
import type { IncomingPart } from '../llm/types.js';

import type { AgentError } from '../util/error.js';

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
  skills?: ReadonlyArray<{ name: string; path: string }>;
  /** steer 路径下由前端提供，作为 `PendingUserInput.id` 原样透传 */
  inputId?: string;
}

export type RunTurnResult =
  | { kind: 'turn'; stream: AsyncGenerator<FrameBody>; sessionId: string }
  | { kind: 'queued'; sessionId: string; turnId: number };

export interface AgentShape {
  runTurn(input: IncomingPart[], opts: RunTurnOptions): Effect.Effect<RunTurnResult, AgentError>;
}

export class AgentService extends Context.Tag('AgentService')<AgentService, AgentShape>() {}

export interface ToolEnv {
  provide<R, E, A>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, never>;
}

export class ToolEnvPort extends Context.Tag('AgentToolEnvPort')<
  ToolEnvPort,
  {
    getToolEnv(): Effect.Effect<ToolEnv>;
  }
>() {}
