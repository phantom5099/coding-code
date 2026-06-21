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

  it('parses JSON envelope for { type: "allow" }', () => {
    expect(parseApprovalResponse('{"type":"allow"}')).toEqual({ type: 'allow' });
  });

  it('parses JSON envelope for { type: "deny" }', () => {
    expect(parseApprovalResponse('{"type":"deny"}')).toEqual({ type: 'deny' });
  });

  it('parses JSON envelope for { type: "canceled" }', () => {
    expect(parseApprovalResponse('{"type":"canceled"}')).toEqual({ type: 'canceled' });
  });

  it('parses JSON envelope for { type: "modified", input: {...} }', () => {
    expect(
      parseApprovalResponse('{"type":"modified","input":{"plan_content":"# v2"}}')
    ).toEqual({
      type: 'modified',
      input: { plan_content: '# v2' },
    });
  });

  it('falls back to deny when JSON input is missing for modified', () => {
    expect(parseApprovalResponse('{"type":"modified"}')).toEqual({ type: 'deny' });
  });

  it('falls back to deny when JSON input is not an object for modified', () => {
    expect(parseApprovalResponse('{"type":"modified","input":"oops"}')).toEqual({ type: 'deny' });
  });

  it('falls back to deny on malformed JSON', () => {
    expect(parseApprovalResponse('{not-json')).toEqual({ type: 'deny' });
  });

  it('falls back to deny on unknown JSON type', () => {
    expect(parseApprovalResponse('{"type":"weird"}')).toEqual({ type: 'deny' });
  });

  it('synthesizes persistent allow rule from JSON "always" envelope', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-20T12:00:00Z'));
    expect(parseApprovalResponse('{"type":"always"}')).toEqual({
      type: 'always',
      rule: {
        id: 'user-allow-1779278400000',
        action: 'allow',
        toolPattern: '*',
        reason: 'User always allows',
        source: 'user',
      },
    });
    vi.useRealTimers();
  });

  it('synthesizes persistent deny rule from JSON "never" envelope', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-20T12:00:00Z'));
    expect(parseApprovalResponse('{"type":"never"}')).toEqual({
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
