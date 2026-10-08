import { Context } from 'effect';
import type { Effect } from 'effect';
import type { ConfirmResult } from './confirmation.js';

export interface ApprovalWaitShape {
  waitForConfirm(id: string, sessionId: string): Effect.Effect<ConfirmResult>;
  resolveConfirm(id: string, sessionId: string, result: ConfirmResult): Effect.Effect<boolean>;
  /** 会话结束时按 sessionId 清掉待决审批（fail-closed 成 deny），返回清理条数 */
  cancelPendingFor(sessionId: string): Effect.Effect<number>;
}

export class ApprovalWaitService extends Context.Tag('ApprovalWait')<
  ApprovalWaitService,
  ApprovalWaitShape
>() {}
