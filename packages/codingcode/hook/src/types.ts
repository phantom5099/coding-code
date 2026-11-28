import type { Effect } from 'effect';
import type { ConfigScope } from '@codingcode/util';
import type { ConfigMutationOutcome, ScopedConfigEntry } from '@codingcode/infra';

export const HOOK_POINT = {
  TOOL_EXECUTE_BEFORE: 'tool.execute.before',
  TOOL_EXECUTE_AFTER: 'tool.execute.after',
  TOOL_EXECUTE_ERROR: 'tool.execute.error',
  TOOL_APPROVAL_PRE: 'tool.approval.pre',
  TOOL_APPROVAL_POST: 'tool.approval.post',
  AGENT_TURN_START: 'agent.turn.start',
  AGENT_STEP_BEFORE: 'agent.step.before',
  AGENT_TURN_STOP: 'agent.turn.stop',
  AGENT_TURN_END: 'agent.turn.end',
  AGENT_SUBAGENT_SPAWN_BEFORE: 'agent.subagent.spawn.before',
  AGENT_SUBAGENT_SPAWN_AFTER: 'agent.subagent.spawn.after',
  AGENT_SUBAGENT_COMPLETE: 'agent.subagent.complete',
} as const;

export type HookPoint = (typeof HOOK_POINT)[keyof typeof HOOK_POINT];

export type HookKind = 'observer' | 'decision';
export type HookDecisionKind = 'allow' | 'deny' | 'ask' | 'continue';

export interface HookBasePayload {
  readonly projectPath?: string;
}

export interface HookPayloadMap {
  [HOOK_POINT.TOOL_EXECUTE_BEFORE]: HookBasePayload & {
    readonly toolName: string;
    readonly args: Record<string, unknown>;
    readonly sessionId: string;
    readonly turnId: number;
    readonly projectPath: string;
    readonly callId: string;
  };
  [HOOK_POINT.TOOL_EXECUTE_AFTER]: HookBasePayload & {
    readonly toolName: string;
    readonly args: Record<string, unknown>;
    readonly result: string;
    readonly durationMs?: number;
    readonly sessionId: string;
    readonly turnId: number;
    readonly projectPath: string;
    readonly callId: string;
  };
  [HOOK_POINT.TOOL_EXECUTE_ERROR]: HookBasePayload & {
    readonly toolName: string;
    readonly args: Record<string, unknown>;
    readonly error: unknown;
    readonly sessionId?: string;
    readonly turnId?: number;
    readonly projectPath: string;
    readonly callId?: string;
  };
  [HOOK_POINT.TOOL_APPROVAL_PRE]: HookBasePayload & {
    readonly toolName: string;
    readonly args: Record<string, unknown>;
    readonly sessionId: string;
  };
  [HOOK_POINT.TOOL_APPROVAL_POST]: HookBasePayload & {
    readonly tool: string;
    readonly input: Record<string, unknown>;
    readonly decision: unknown;
    readonly layers: readonly string[];
  };
  [HOOK_POINT.AGENT_TURN_START]: HookBasePayload & {
    readonly sessionId: string;
    readonly projectPath: string;
  };
  [HOOK_POINT.AGENT_STEP_BEFORE]: HookBasePayload & {
    readonly sessionId: string;
    readonly step: number;
    readonly projectPath: string;
  };
  [HOOK_POINT.AGENT_TURN_STOP]: HookBasePayload & {
    readonly sessionId: string;
    readonly content: string;
    readonly turnId: number;
    readonly projectPath: string;
  };
  [HOOK_POINT.AGENT_TURN_END]: HookBasePayload & {
    readonly sessionId: string;
    readonly turnId: number;
    readonly status: 'done' | 'error' | 'maxSteps' | 'aborted';
    readonly projectPath: string;
  };
  [HOOK_POINT.AGENT_SUBAGENT_SPAWN_BEFORE]: HookBasePayload & {
    readonly agentName: string;
    readonly prompt: string;
    readonly parentSessionId: string;
    readonly projectPath: string;
  };
  [HOOK_POINT.AGENT_SUBAGENT_SPAWN_AFTER]: HookBasePayload & {
    readonly childSessionId: string;
    readonly agentName: string;
    readonly projectPath: string;
  };
  [HOOK_POINT.AGENT_SUBAGENT_COMPLETE]: HookBasePayload & {
    readonly projectPath: string;
    readonly childSessionId: string;
    readonly agentName: string;
    readonly status: 'completed' | 'failed';
  };
}

export interface HookDecision {
  readonly decision?: HookDecisionKind;
  readonly reason?: string;
  readonly injection?: string;
  readonly modifiedInput?: Record<string, unknown>;
}

/** hook 子进程 stdout 解析出的原始对象；映射成 HookDecision 收在 hooks.ts 一处。 */
export type HookCommandOutput = Record<string, unknown>;

export interface UserHookConfig {
  name: string;
  description?: string;
  point: HookPoint;
  type: HookKind;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  priority?: number;
  /** 开关：false 表示禁用。缺省（undefined）等同启用 */
  enabled?: boolean;
}

export type HookConfigOutcome = ConfigMutationOutcome;
export type HookConfigEntry = ScopedConfigEntry<UserHookConfig>;

export interface CreateHookCommand {
  readonly scope: ConfigScope;
  readonly hook: UserHookConfig;
}

export interface UpdateHookCommand {
  readonly scope: ConfigScope;
  readonly name: string;
  readonly hook: UserHookConfig;
}

export interface DeleteHookCommand {
  readonly scope: ConfigScope;
  readonly name: string;
}

export interface SetHookEnabledCommand {
  readonly scope: ConfigScope;
  readonly name: string;
  readonly enabled: boolean;
}

/** 观察者：只被通知，返回值被忽略 */
export type ObserverHandler = (payload: HookBasePayload) => Effect.Effect<void>;

/** 决策者：返回首个非 null 结果即短路 */
export type DecisionHandler = (
  payload: HookBasePayload
) => HookDecision | null | Promise<HookDecision | null>;

export type HandlerEntry =
  | { readonly type: 'observer'; readonly priority: number; readonly handler: ObserverHandler }
  | { readonly type: 'decision'; readonly priority: number; readonly handler: DecisionHandler };
