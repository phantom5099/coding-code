import { Context } from 'effect';
import type { Effect } from 'effect';
import type { PermissionMode, PermissionRule, ApprovalDecision } from './types.js';

export interface ApprovalShape {
  evaluate(request: { tool: string; input: Record<string, unknown>; context?: Record<string, unknown>; callId?: string; sessionId: string; projectPath?: string }): Effect.Effect<ApprovalDecision>;
  addRule(rule: PermissionRule): Effect.Effect<void>;
  removeRule(id: string): Effect.Effect<void>;
  setPermissionMode(mode: PermissionMode): Effect.Effect<void>;
  getPermissionMode(): PermissionMode;
  fork(opts?: { extraDenyRules?: PermissionRule[]; readonly?: boolean; permissionMode?: PermissionMode }): Effect.Effect<ApprovalShape>;
}

export class ApprovalService extends Context.Tag('Approval')<ApprovalService, ApprovalShape>() {}
