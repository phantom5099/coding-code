import type { ConfirmResult } from './confirmation.js';

/**
 * Parses a JSON or legacy string approval response from the desktop client.
 * Tool approval only — the plan-approval modal uses a richer vocabulary
 * (allow / modified / canceled) and is parsed by `parsePlanApprovalResponse`
 * in `plan/`. The two wire protocols share the legacy `'allow' | 'deny'`
 * codes but the plan path is the only one that accepts `modified`/`canceled`.
 */
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
