import type { Effect } from 'effect';

export type HookPoint =
  | 'tool.execute.before'
  | 'tool.execute.after'
  | 'tool.execute.error'
  | 'tool.approval.pre'
  | 'tool.approval.post'
  | 'agent.turn.start'
  | 'agent.step.before'
  | 'agent.turn.stop'
  | 'agent.turn.end'
  | 'agent.subagent.spawn.before'
  | 'agent.subagent.spawn.after'
  | 'agent.subagent.complete';

export interface HookDecision {
  decision?: 'allow' | 'deny' | 'ask' | 'continue';
  reason?: string;
  injection?: string;
  modifiedInput?: Record<string, unknown>;
}

/** hook 子进程 stdout 解析出的原始对象；映射成 HookDecision 收在 hooks.ts 一处。 */
export type HookCommandOutput = Record<string, unknown>;

export interface UserHookConfig {
  name: string;
  description?: string;
  point: HookPoint;
  type: 'observer' | 'decision';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  priority?: number;
  /** 开关：false 表示禁用。缺省（undefined）等同启用 */
  enabled?: boolean;
}

/** 观察者：只被通知，返回值被忽略 */
export type ObserverHandler = (payload: Record<string, unknown>) => Effect.Effect<void, never, any>;

/** 决策者：返回首个非 null 结果即短路 */
export type DecisionHandler = (
  payload: Record<string, unknown>
) => HookDecision | null | Promise<HookDecision | null>;

export interface HandlerEntry {
  handler: ObserverHandler | DecisionHandler;
  priority: number;
  type: 'observer' | 'decision';
}

export type ProjectPath = string;
