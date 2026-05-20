import type { ConfirmResult } from './confirmation.js';

export function parseApprovalResponse(response: string): ConfirmResult {
  switch (response) {
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
