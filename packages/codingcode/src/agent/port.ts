import { Context } from 'effect';
import type { Effect } from 'effect';
import type { FrameBody } from '../contracts/frame.js';
import type { ProfileName } from '../contracts/types.js';
import type { PermissionMode } from '../contracts/permission.js';

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
