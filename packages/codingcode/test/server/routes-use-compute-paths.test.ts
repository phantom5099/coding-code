import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('server routes use computePaths not hand-rolled replace', () => {
  it('server/routes/sessions.ts no longer uses sessionJsonlPathFromCwd + replace .jsonl/.index.json', () => {
    const src = readFileSync(
      'C:/Users/10116/Desktop/agent/coding code/packages/codingcode/src/server/routes/sessions.ts',
      'utf8'
    );
    expect(src).not.toMatch(/sessionJsonlPathFromCwd\([^)]+\)\.replace\(['"]\.jsonl['"]/);
  });

  it('server/routes/messages.ts uses computePaths(cwd, sessionId).indexPath', () => {
    const src = readFileSync(
      'C:/Users/10116/Desktop/agent/coding code/packages/codingcode/src/server/routes/messages.ts',
      'utf8'
    );
    expect(src).toMatch(/computePaths\([^)]+\)\.indexPath/);
    expect(src).not.toMatch(/sessionJsonlPathFromCwd\(/);
  });
});
