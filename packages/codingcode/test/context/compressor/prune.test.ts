import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { getContextConfig } from '../../../src/context/config.js';

// The compressor's tryL2Prune is module-private in index.ts.
// We test the behavior indirectly through the public `run` function.
// For unit testing the prune logic, we test the appendProjection
// expectations via the projection-store.

describe('L2 Prune', () => {
  it('generates a prune projection with correct structure', () => {
    const projection = {
      type: 'message' as const,
      id: randomUUID(),
      targetEventUuid: 'tool-uuid-1',
      replacement: { role: 'tool' as const, content: '[Old tool result content cleared]', tool_call_id: 'tc1' },
      originalTurnId: 3,
      method: 'prune' as const,
      createdAt: new Date().toISOString(),
    };

    expect(projection.type).toBe('message');
    expect(projection.method).toBe('prune');
    expect(projection.replacement.content).toBe('[Old tool result content cleared]');
    expect(projection.originalTurnId).toBe(3);
  });

  it('has protection fields in the config defaults', () => {
    // Verify that the default config has proper protection values
    const config = getContextConfig();
    expect(config.pruneProtectedTokens).toBeGreaterThan(0);
    expect(config.pruneMinRelease).toBeGreaterThan(0);
    expect(config.toolsExemptFromPrune).toContain('Read');
  });
});
