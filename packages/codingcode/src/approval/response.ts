import type { ConfirmResult } from './confirmation.js';

/**
 * Parses a JSON approval response from the desktop client. The wire format
 * allows a richer vocabulary than the legacy string protocol so that
 * the plan-approval modal can express "implement with this revised content"
 * ({@link ConfirmResult.modified}) and "cancel the approval entirely"
 * ({@link ConfirmResult.canceled}).
 */
export function parseApprovalResponse(raw: string): ConfirmResult {
  // Try JSON first — new clients send an object describing the decision.
  if (raw && raw.startsWith('{')) {
    try {
      const obj = JSON.parse(raw) as {
        type?: string;
        input?: Record<string, unknown>;
      };
      switch (obj.type) {
        case 'allow':
          return { type: 'allow' };
        case 'deny':
          return { type: 'deny' };
        case 'always':
          return {
            type: 'always',
            rule: {
              id: `user-allow-${Date.now()}`,
              action: 'allow',
              toolPattern: '*',
              reason: 'User always allows',
              source: 'user',
            },
          };
        case 'never':
          return {
            type: 'never',
            rule: {
              id: `user-deny-${Date.now()}`,
              action: 'deny',
              toolPattern: '*',
              reason: 'User never allows',
              source: 'user',
            },
          };
        case 'modified':
          if (obj.input && typeof obj.input === 'object') {
            return { type: 'modified', input: obj.input };
          }
          return { type: 'deny' };
        case 'canceled':
          return { type: 'canceled' };
        default:
          return { type: 'deny' };
      }
    } catch {
      return { type: 'deny' };
    }
  }

  // Legacy string protocol — kept for backward compatibility with older clients.
  switch (raw) {
    case 'allow':
      return { type: 'allow' };
    case 'deny':
      return { type: 'deny' };
    case 'always':
      return {
        type: 'always',
        rule: {
          id: `user-allow-${Date.now()}`,
          action: 'allow',
          toolPattern: '*',
          reason: 'User always allows',
          source: 'user',
        },
      };
    case 'never':
      return {
        type: 'never',
        rule: {
          id: `user-deny-${Date.now()}`,
          action: 'deny',
          toolPattern: '*',
          reason: 'User never allows',
          source: 'user',
        },
      };
    default:
      return { type: 'deny' };
  }
}
