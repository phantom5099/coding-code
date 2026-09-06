import { Context } from 'effect';
import type { Effect } from 'effect';
import type { AgentEvent } from './types.js';
import type { AgentProfileName } from './profile.js';
import type { PermissionMode } from '../approval/types.js';

export interface RunTurnOptions {
  sessionId?: string;
  cwd: string;
  signal?: AbortSignal;
  permissionMode?: PermissionMode;
  model?: string;
  activeProfile?: AgentProfileName;
}

export interface AgentShape {
  runTurn(
    input: string,
    opts: RunTurnOptions
  ): Effect.Effect<{
    stream: AsyncGenerator<AgentEvent>;
    sessionId: string;
  }>;
}

export class AgentService extends Context.Tag('AgentService')<AgentService, AgentShape>() {}
