import { Context } from 'effect';
import type { Effect } from 'effect';
import type { PermissionMode } from '@codingcode/util';
import type { SessionKey } from '@codingcode/session';
import type { PreparedToolCall } from '@codingcode/tool';
import type { SandboxEscalationRequest } from '@codingcode/sandbox';

export type ApprovalDecisionSource =
  | 'unrestricted'
  | 'dangerous-operation'
  | 'permission-mode'
  | 'hook'
  | 'user-confirm'
  | `rule:${string}`
  | (string & {});

export type ApprovalDecision =
  | { readonly type: 'deny'; readonly reason: string; readonly source: ApprovalDecisionSource }
  | { readonly type: 'allow'; readonly source: ApprovalDecisionSource };

/** 审批请求：待执行的工具调用 + 会话键与权限模式 */
export interface ApprovalRequest {
  readonly prepared: PreparedToolCall;
  readonly session: SessionKey;
  readonly permissionMode?: PermissionMode;
}

export interface ApprovalShape {
  evaluate(request: ApprovalRequest): Effect.Effect<ApprovalDecision>;
  evaluateBatch(requests: readonly ApprovalRequest[]): Effect.Effect<ApprovalDecision[]>;
  evaluateEscalation(request: SandboxEscalationRequest): Effect.Effect<ApprovalDecision>;
  evaluateEscalationBatch(
    requests: readonly SandboxEscalationRequest[]
  ): Effect.Effect<ApprovalDecision[]>;
}

export class ApprovalService extends Context.Tag('Approval')<ApprovalService, ApprovalShape>() {}
