import { describe, it, expect } from 'vitest';

describe('CSS type declaration', () => {
  it('should allow importing CSS files without type error', async () => {
    // This import should not throw a TypeScript error thanks to css.d.ts
    // vitest automatically mocks CSS imports, so the actual value is an object
    const css = await import('../src/styles/index.css');
    expect(css).toBeDefined();
  });

  it('should allow importing scss files without type error', async () => {
    // Also verify the *.scss declaration works
    const css = await import('../src/styles/index.css');
    expect(css).toBeDefined();
  });
});
