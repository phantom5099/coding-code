import { Context } from 'effect';
import type { Effect } from 'effect';
import type { FrameBody } from '@codingcode/sink';
import type { AgentError, PermissionMode } from '@codingcode/util';
import type { SandboxConfig } from '@codingcode/sandbox';
import type { IncomingPart } from '@codingcode/model';
import type { SessionLineage, SubagentMeta } from '@codingcode/session';
import type { SkillRef } from '@codingcode/skill';

export type { SandboxConfig };

export interface RunTurnOptions {
  readonly sessionId?: string;
  readonly cwd: string;
  readonly signal?: AbortSignal;
  readonly permissionMode?: PermissionMode;
  readonly sandbox?: SandboxConfig;
  readonly model: string;
  readonly lineage?: SessionLineage;
  readonly subagent?: SubagentMeta;
  readonly skills?: readonly SkillRef[];
  /** steer 路径下由前端提供，作为 `PendingUserInput.id` 原样透传 */
  readonly inputId?: string;
}

export type RunTurnResult =
  | { readonly kind: 'turn'; readonly stream: AsyncGenerator<FrameBody>; readonly sessionId: string }
  | { readonly kind: 'queued'; readonly sessionId: string; readonly turnId: number };

export interface AgentShape {
  runTurn(
    input: readonly IncomingPart[],
    opts: RunTurnOptions
  ): Effect.Effect<RunTurnResult, AgentError>;
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
