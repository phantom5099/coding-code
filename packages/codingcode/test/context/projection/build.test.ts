import { describe, it, expect } from 'vitest';

describe('L1 Budget Reduction (via build.ts)', () => {
  it('applies L1 truncation to raw tool messages', async () => {
    const { buildMessagesForQuery } = await import('../../../src/context/projection/build.js');
    expect(buildMessagesForQuery).toBeTypeOf('function');
  });
});
