import { Context } from 'effect';
import type { Effect } from 'effect';
import type { FrameBody } from '../sink/types.js';
import type { AgentError } from '../util/error.js';
import type { Result } from '../util/result.js';
import type { ProfileName, PermissionMode } from '../util/enums.js';
import type { IncomingPart } from '../llm/types.js';

export interface RunSubagentOptions {
  sessionId?: string;
  cwd: string;
  activeProfile?: ProfileName;
  permissionMode?: PermissionMode;
  model: string;
  /** 首次派发时的自定义 system prompt；续跑（传 sessionId）时忽略，改由会话头回读 */
  systemPrompt?: string;
  parentSessionId?: string;
  agentName?: string;
  /** 子智能体用途描述；首次派发时写入 meta，续跑不传（meta 已有） */
  description?: string;
  /** 祖先会话 id，由近及远；透传到 runTurn 的回合状态与工具上下文 */
  parentChain?: readonly string[];
}

export interface SubagentRunnerShape {
  runSubagent(
    input: IncomingPart[],
    opts: RunSubagentOptions
  ): Effect.Effect<
    {
      stream: AsyncGenerator<FrameBody, Result<string, AgentError>, unknown>;
      sessionId: string;
    },
    // E：沿用 agent.runTurn 的错误通道（原先声明 never，靠 runTurn 的 as any 掩盖）
    AgentError
  >;
}

export class SubagentRunnerService extends Context.Tag('SubagentRunner')<
  SubagentRunnerService,
  SubagentRunnerShape
>() {}
