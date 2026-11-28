import { describe, expect, it } from 'vitest';
import { parseApprovalResponse } from '@codingcode/approval';

describe('parseApprovalResponse', () => {
  it('maps single-use approval responses', () => {
    expect(parseApprovalResponse('allow')).toEqual({ type: 'allow' });
    expect(parseApprovalResponse('deny')).toEqual({ type: 'deny' });
    expect(parseApprovalResponse('unknown')).toEqual({ type: 'deny' });
  });

  it('fails closed for responses outside the current contract', () => {
    expect(parseApprovalResponse('always')).toEqual({ type: 'deny' });
    expect(parseApprovalResponse('never')).toEqual({ type: 'deny' });
  });
});
