import type { PlanConfirmResult } from './plan-confirm.js';

export function parsePlanApprovalResponse(raw: string): PlanConfirmResult {
  if (raw && raw.startsWith('{')) {
    try {
      const obj = JSON.parse(raw) as {
        type?: string;
        input?: Record<string, unknown>;
      };
      switch (obj.type) {
        case 'allow':
          return { type: 'allow' };
        case 'modified':
          if (obj.input && typeof obj.input === 'object') {
            return { type: 'modified', input: obj.input };
          }
          return { type: 'canceled' };
        case 'canceled':
          return { type: 'canceled' };
        default:
          return { type: 'canceled' };
      }
    } catch {
      return { type: 'canceled' };
    }
  }

  // Legacy string protocol.
  switch (raw) {
    case 'allow':
      return { type: 'allow' };
    default:
      return { type: 'canceled' };
  }
}
