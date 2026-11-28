export type { ApprovalAction } from '@codingcode/util';

/** 审批管道评估目标：与 ToolCall 保持同一命名口径 */
export interface ApprovalTarget {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export type RuleAction = 'deny' | 'allow' | 'ask';

export interface PermissionRule {
  id: string;
  action: RuleAction;
  toolPattern: string;
  argPattern?: string;
  argRegex?: RegExp;
  reason?: string;
  priority?: number;
  source?: 'system' | 'user';
}
