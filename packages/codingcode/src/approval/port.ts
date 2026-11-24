import { Context } from 'effect';
import type { Effect } from 'effect';
import type { PermissionMode } from '../util/enums.js';
import type { ToolCallRequest } from './types.js';
import type { PreparedToolCall } from '../tools/types.js';
import type { SandboxEscalationRequest } from '../sandbox/types.js';

export type ApprovalDecision =
  | { type: 'deny'; reason: string; source: string }
  | { type: 'allow'; source: string };

/** 审批请求：工具调用 + 审批上下文。 */
export interface ApprovalRequest extends ToolCallRequest {
  prepared: PreparedToolCall;
  sessionId: string;
  projectPath?: string;
  permissionMode?: PermissionMode;
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
