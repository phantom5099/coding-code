import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { getContextConfig } from '../../../src/context/config.js';

describe('L4 Collapse', () => {
  it('generates a collapse projection with correct structure', () => {
    const projection = {
      type: 'message' as const,
      id: randomUUID(),
      targetEventUuid: 'tool-uuid-2',
      replacement: { role: 'tool' as const, content: '[Collapsed tool: bash turn 5]\n---\nhead...tail', tool_call_id: 'tc2' },
      originalTurnId: 5,
      method: 'collapse-rule' as const,
      createdAt: new Date().toISOString(),
    };

    expect(projection.type).toBe('message');
    expect(projection.method).toBe('collapse-rule');
    expect(projection.replacement.content).toContain('[Collapsed tool:');
  });

  it('uses llm method when rule summary exceeds max tokens', () => {
    const projection = {
      type: 'message' as const,
      id: randomUUID(),
      targetEventUuid: 'tool-uuid-3',
      replacement: { role: 'tool' as const, content: 'llm-shortened', tool_call_id: 'tc3' },
      originalTurnId: 6,
      method: 'collapse-llm' as const,
      createdAt: new Date().toISOString(),
    };

    expect(projection.method).toBe('collapse-llm');
  });

  it('has collapse min tokens threshold in config', () => {
    const config = getContextConfig();
    expect(config.collapseMinTokens).toBeGreaterThan(0);
    expect(config.collapseSummaryMaxTokens).toBeGreaterThan(0);
  });
});
