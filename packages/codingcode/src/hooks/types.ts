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

/** 配置写操作的结果：只表达成败与原因，HTTP 语义由调用方翻译 */
export type HookConfigOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'not-found' | 'already-exists' };

/** 列表项：配置 + 归一后的 enabled 与来源标注 */
export interface HookConfigEntry extends UserHookConfig {
  enabled: boolean;
  source: 'global' | 'project';
  /** 仅项目层返回；全局层不带该键 */
  hasProjectOverride?: boolean;
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
