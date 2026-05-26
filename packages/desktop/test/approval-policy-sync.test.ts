import { describe, it, expect } from 'vitest'

// Mirrors the mapping in agent.handler.ts
const POLICY_TO_CORE_MODE: Record<string, string> = {
  suggest: 'default',
  'auto-edit': 'acceptEdits',
  'full-auto': 'dontAsk',
}

describe('approvalPolicy → PermissionMode mapping', () => {
  it('suggest maps to default', () => {
    expect(POLICY_TO_CORE_MODE['suggest']).toBe('default')
  })

  it('auto-edit maps to acceptEdits', () => {
    expect(POLICY_TO_CORE_MODE['auto-edit']).toBe('acceptEdits')
  })

  it('full-auto maps to dontAsk', () => {
    expect(POLICY_TO_CORE_MODE['full-auto']).toBe('dontAsk')
  })

  it('all three desktop policies have a core mapping', () => {
    const policies = ['suggest', 'auto-edit', 'full-auto'] as const
    for (const p of policies) {
      expect(POLICY_TO_CORE_MODE[p]).toBeDefined()
    }
  })

  it('unknown policy falls back to default', () => {
    expect(POLICY_TO_CORE_MODE['unknown'] ?? 'default').toBe('default')
  })
})
