import { Context } from 'effect';
import type { Effect } from 'effect';
import type { ConfirmResult } from './confirmation.js';

export interface ApprovalWaitShape {
  waitForConfirm(id: string, sessionId: string): Effect.Effect<ConfirmResult>;
  resolveConfirm(id: string, sessionId: string, result: ConfirmResult): Effect.Effect<boolean>;
  getPending(sessionId?: string): Effect.Effect<string[]>;
  emitApprovalRequest(sessionId: string, id: string, tool: string, args: Record<string, unknown>): Effect.Effect<void>;
  registerEmitter(sessionId: string, fn: (id: string, tool: string, args: Record<string, unknown>) => void): Effect.Effect<void>;
  delegateEmitter(childSessionId: string, parentSessionId: string): Effect.Effect<void>;
  unregisterEmitter(sessionId: string): Effect.Effect<void>;
  hasEmitter(sessionId: string): Effect.Effect<boolean>;
}

export class ApprovalWaitService extends Context.Tag('ApprovalWait')<ApprovalWaitService, ApprovalWaitShape>() {}
