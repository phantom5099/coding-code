import { Context } from 'effect';
import type { Effect } from 'effect';
import type { AgentEvent } from '../agent/types.js';
import type { AgentError } from '../core/error.js';
import type { Result } from '../core/result.js';

export interface RunSubagentOptions {
  sessionId?: string;
  cwd: string;
  signal?: AbortSignal;
  activeProfile?: import('../core/types.js').ProfileName;
  permissionMode?: import('../approval/types.js').PermissionMode;
  model?: string;
  parentSessionId?: string;
  agentName?: string;
}

export interface SubagentRunnerShape {
  runSubagent(input: string, opts: RunSubagentOptions): Effect.Effect<{
    stream: AsyncGenerator<AgentEvent, Result<string, AgentError>, unknown>;
    sessionId: string;
  }>;
}

export class SubagentRunnerService extends Context.Tag('SubagentRunner')<SubagentRunnerService, SubagentRunnerShape>() {}
