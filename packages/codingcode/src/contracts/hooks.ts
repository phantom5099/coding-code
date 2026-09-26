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
  modifiedOutput?: unknown;
}

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
