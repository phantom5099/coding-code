import { Context } from 'effect';
import type { Effect } from 'effect';
import type { PermissionMode, PermissionRule, ApprovalDecision } from './types.js';

export interface ApprovalShape {
  evaluate(request: { tool: string; input: Record<string, unknown>; context?: Record<string, unknown>; callId?: string; sessionId: string; projectPath?: string }): Effect.Effect<ApprovalDecision>;
  fork(opts?: { extraDenyRules?: PermissionRule[]; readonly?: boolean; permissionMode?: PermissionMode }): Effect.Effect<ApprovalShape>;
}

export class ApprovalService extends Context.Tag('Approval')<ApprovalService, ApprovalShape>() {}
