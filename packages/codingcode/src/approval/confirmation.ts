import { Effect } from 'effect';
import { ApprovalWaitService } from './wait-port.js';
import { EventSinkService } from '../sink/port.js';
import type { ApprovalAction } from './types.js';

export type ConfirmResult = { type: 'allow' } | { type: 'deny' };

export function userConfirmAsync(
  tool: string,
  args: Record<string, unknown>,
  sessionId: string,
  callId: string,
  action: ApprovalAction
): Effect.Effect<ConfirmResult, never, ApprovalWaitService | EventSinkService> {
  return Effect.gen(function* () {
    const waitSvc = yield* ApprovalWaitService;
    const sink = yield* EventSinkService;
    const id = callId;

    yield* sink.emit(sessionId, {
      family: 'event',
      event: { type: 'approval_request', id, tool, action, args },
    });

    return yield* waitSvc.waitForConfirm(id, sessionId);
  });
}

export function parseApprovalResponse(response: string): ConfirmResult {
  switch (response) {
    case 'allow':
      return { type: 'allow' };
    case 'deny':
      return { type: 'deny' };
    default:
      return { type: 'deny' };
  }
}
