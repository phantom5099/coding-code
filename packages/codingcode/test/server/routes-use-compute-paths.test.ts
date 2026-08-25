import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('server routes use computePaths not hand-rolled replace', () => {
  it('server/routes/sessions.ts no longer uses sessionJsonlPathFromCwd + replace .jsonl/.index.json', () => {
    const src = readFileSync(
      new URL('../../src/server/routes/sessions.ts', import.meta.url),
      'utf8'
    );
    expect(src).not.toMatch(/sessionJsonlPathFromCwd\([^)]+\)\.replace\(['"]\.jsonl['"]/);
  });

  it('server/routes/messages.ts uses computePaths(cwd, sessionId).indexPath', () => {
    const src = readFileSync(
      new URL('../../src/server/routes/messages.ts', import.meta.url),
      'utf8'
    );
    expect(src).toMatch(/computePaths\([^)]+\)\.indexPath/);
    expect(src).not.toMatch(/sessionJsonlPathFromCwd\(/);
  });
});
