import { Context } from 'effect';
import type { Effect } from 'effect';
import type { ProfileName } from '../contracts/types.js';
import type { PermissionMode, ApprovalDecision } from '../contracts/permission.js';

export interface ApprovalShape {
  evaluate(request: { tool: string; input: Record<string, unknown>; context?: Record<string, unknown>; callId?: string; sessionId: string; projectPath?: string; permissionMode?: PermissionMode; profile?: ProfileName }): Effect.Effect<ApprovalDecision>;
}

export class ApprovalService extends Context.Tag('Approval')<ApprovalService, ApprovalShape>() {}
