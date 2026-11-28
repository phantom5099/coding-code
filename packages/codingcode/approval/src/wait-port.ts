import { Context } from 'effect';
import type { Effect } from 'effect';
import type { PendingCallKey } from '@codingcode/util';
import type { ConfirmResult } from './confirmation.js';

export type ConfirmationKey = PendingCallKey;

export interface ResolveConfirmCommand extends ConfirmationKey {
  readonly result: ConfirmResult;
}

export interface ApprovalWaitShape {
  waitForConfirm(key: ConfirmationKey): Effect.Effect<ConfirmResult>;
  resolveConfirm(cmd: ResolveConfirmCommand): Effect.Effect<boolean>;
  /** 会话结束时按 sessionId 清掉待决审批（fail-closed 成 deny），返回清理条数 */
  cancelPendingFor(sessionId: string): Effect.Effect<number>;
}

export class ApprovalWaitService extends Context.Tag('ApprovalWait')<
  ApprovalWaitService,
  ApprovalWaitShape
>() {}
