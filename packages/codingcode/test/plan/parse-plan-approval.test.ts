import { describe, it, expect } from 'vitest';
import { parsePlanApprovalResponse } from '../../src/plan/parse-plan-approval.js';

describe('parsePlanApprovalResponse', () => {
  describe('JSON envelope', () => {
    it('parses {"type":"allow"}', () => {
      expect(parsePlanApprovalResponse('{"type":"allow"}')).toEqual({ type: 'allow' });
    });

    it('parses {"type":"modified","input":{...}}', () => {
      const input = { plan_content: '# revised plan' };
      expect(parsePlanApprovalResponse(JSON.stringify({ type: 'modified', input }))).toEqual({
        type: 'modified',
        input,
      });
    });

    it('parses {"type":"canceled"}', () => {
      expect(parsePlanApprovalResponse('{"type":"canceled"}')).toEqual({ type: 'canceled' });
    });

    it('falls back to canceled for missing type field', () => {
      expect(parsePlanApprovalResponse('{}')).toEqual({ type: 'canceled' });
    });

    it('falls back to canceled for unknown type', () => {
      expect(parsePlanApprovalResponse('{"type":"weird"}')).toEqual({ type: 'canceled' });
    });

    it('falls back to canceled for modified without object input', () => {
      expect(parsePlanApprovalResponse('{"type":"modified"}')).toEqual({ type: 'canceled' });
    });

    it('falls back to canceled for malformed JSON', () => {
      expect(parsePlanApprovalResponse('{not-json')).toEqual({ type: 'canceled' });
    });
  });

  describe('legacy string protocol', () => {
    it('parses "allow" as allow', () => {
      expect(parsePlanApprovalResponse('allow')).toEqual({ type: 'allow' });
    });

    it('treats any other string as canceled (safe default)', () => {
      expect(parsePlanApprovalResponse('y')).toEqual({ type: 'canceled' });
      expect(parsePlanApprovalResponse('n')).toEqual({ type: 'canceled' });
      expect(parsePlanApprovalResponse('yes')).toEqual({ type: 'canceled' });
      expect(parsePlanApprovalResponse('')).toEqual({ type: 'canceled' });
    });
  });
});
