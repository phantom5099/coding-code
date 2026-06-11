import { Effect } from 'effect';
import type { PermissionRule } from './types.js';
import { ApprovalWaitService } from './async-confirm.js';

export type ConfirmResult =
  | { type: 'allow' }
  | { type: 'deny' }
  | { type: 'always'; rule: PermissionRule }
  | { type: 'never'; rule: PermissionRule };

export function userConfirmAsync(
  tool: string,
  args: Record<string, unknown>,
  waitSvc: ApprovalWaitService,
  sessionId: string,
  callId: string
): Effect.Effect<ConfirmResult> {
  return Effect.gen(function* () {
    const id = callId;

    yield* waitSvc.emitApprovalRequest(sessionId, id, tool, args);

    // Suspend until resolveConfirm is called
    return yield* waitSvc.waitForConfirm(id, sessionId);
  });
}
