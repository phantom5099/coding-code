import { Context } from 'effect';
import type { Effect } from 'effect';
import type { FrameBody } from '../contracts/frame.js';
import type { AgentError } from '../core/error.js';
import type { Result } from '../core/result.js';

export interface RunSubagentOptions {
  sessionId?: string;
  cwd: string;
  signal?: AbortSignal;
  activeProfile?: import('../contracts/types.js').ProfileName;
  permissionMode?: import('../contracts/permission.js').PermissionMode;
  model?: string;
  parentSessionId?: string;
  agentName?: string;
}

export interface SubagentRunnerShape {
  runSubagent(input: string, opts: RunSubagentOptions): Effect.Effect<
    {
      stream: AsyncGenerator<FrameBody, Result<string, AgentError>, unknown>;
      sessionId: string;
    },
    // E：沿用 agent.runTurn 的错误通道（原先声明 never，靠 runTurn 的 as any 掩盖）
    AgentError
  >;
}

export class SubagentRunnerService extends Context.Tag('SubagentRunner')<SubagentRunnerService, SubagentRunnerShape>() {}
