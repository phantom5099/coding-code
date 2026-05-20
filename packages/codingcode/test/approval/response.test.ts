import { describe, expect, it, vi } from 'vitest';
import { parseApprovalResponse } from '../../src/approval/response.js';

describe('parseApprovalResponse', () => {
  it('maps single-use approval responses', () => {
    expect(parseApprovalResponse('allow')).toEqual({ type: 'allow' });
    expect(parseApprovalResponse('deny')).toEqual({ type: 'deny' });
    expect(parseApprovalResponse('unknown')).toEqual({ type: 'deny' });
  });

  it('creates persistent allow and deny rules', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-20T12:00:00Z'));

    expect(parseApprovalResponse('always')).toEqual({
      type: 'always',
      rule: {
        id: 'user-allow-1779278400000',
        action: 'allow',
        toolPattern: '*',
        reason: 'User always allows',
        source: 'user',
      },
    });
    expect(parseApprovalResponse('never')).toEqual({
      type: 'never',
      rule: {
        id: 'user-deny-1779278400000',
        action: 'deny',
        toolPattern: '*',
        reason: 'User never allows',
        source: 'user',
      },
    });

    vi.useRealTimers();
  });
});
