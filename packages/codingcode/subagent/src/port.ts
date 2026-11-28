import { Context } from 'effect';
import type { Effect } from 'effect';
import type { FrameBody } from '@codingcode/sink';
import type { AgentError } from '@codingcode/util';
import type { IncomingPart } from '@codingcode/model';
import type { RunTurnOptions } from '@codingcode/agent';

/** 子代理回合选项：直接由 RunTurnOptions 派生，避免三层平铺复制 */
export type RunSubagentOptions = Omit<RunTurnOptions, 'signal' | 'skills' | 'inputId'>;

export interface SubagentRunResult {
  readonly stream: AsyncGenerator<FrameBody>;
  readonly sessionId: string;
}

export interface SubagentRunnerShape {
  runSubagent(
    input: readonly IncomingPart[],
    opts: RunSubagentOptions
  ): Effect.Effect<SubagentRunResult, AgentError>;
}

export class SubagentRunnerService extends Context.Tag('SubagentRunner')<
  SubagentRunnerService,
  SubagentRunnerShape
>() {}
