import { createHash } from 'crypto';

export function shortSid(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 8);
}

export function commitMsg(sessionId: string, turnId: number, suffix: string): string {
  return `turn-${shortSid(sessionId)}-${turnId}-${suffix}`;
}
