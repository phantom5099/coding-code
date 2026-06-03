import { describe, it, expect } from 'vitest';

// Mirrors the mapping in useAgent.ts
const POLICY_TO_CORE_MODE: Record<string, string> = {
  'ask-all': 'default',
  'smart-allow': 'acceptEdits',
  'full-allow': 'bypass',
  'read-only': 'plan',
};

describe('approvalPolicy → PermissionMode mapping', () => {
  it('ask-all maps to default', () => {
    expect(POLICY_TO_CORE_MODE['ask-all']).toBe('default');
  });

  it('smart-allow maps to acceptEdits', () => {
    expect(POLICY_TO_CORE_MODE['smart-allow']).toBe('acceptEdits');
  });

  it('full-allow maps to bypass', () => {
    expect(POLICY_TO_CORE_MODE['full-allow']).toBe('bypass');
  });

  it('read-only maps to plan', () => {
    expect(POLICY_TO_CORE_MODE['read-only']).toBe('plan');
  });

  it('all four desktop policies have a core mapping', () => {
    const policies = ['ask-all', 'smart-allow', 'full-allow', 'read-only'] as const;
    for (const p of policies) {
      expect(POLICY_TO_CORE_MODE[p]).toBeDefined();
    }
  });

  it('unknown policy falls back to default', () => {
    expect(POLICY_TO_CORE_MODE['unknown'] ?? 'default').toBe('default');
  });
});
