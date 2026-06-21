import type { ConfirmResult } from './confirmation.js';

export function parseApprovalResponse(raw: string): ConfirmResult {
  if (raw && raw.startsWith('{')) {
    try {
      const obj = JSON.parse(raw) as { type?: string };
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
        default:
          return { type: 'deny' };
      }
    } catch {
      return { type: 'deny' };
    }
  }

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
