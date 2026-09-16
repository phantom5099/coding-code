import { Context } from 'effect';
import type { Effect } from 'effect';
import type { ProfileName } from '../contracts/types.js';
import type { PermissionMode, ApprovalDecision } from '../contracts/permission.js';
import type { ToolCallRequest } from './types.js';

/** 审批请求：工具调用 + 审批上下文。 */
export interface ApprovalRequest extends ToolCallRequest {
  sessionId: string;
  projectPath?: string;
  permissionMode?: PermissionMode;
  profile?: ProfileName;
}

export interface ApprovalShape {
  evaluate(request: ApprovalRequest): Effect.Effect<ApprovalDecision>;
}

export class ApprovalService extends Context.Tag('Approval')<ApprovalService, ApprovalShape>() {}
