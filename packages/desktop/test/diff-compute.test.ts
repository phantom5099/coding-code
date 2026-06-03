import { describe, it, expect } from 'vitest';
import { computeDiff, wrapUnifiedDiff } from '../src/lib/diff-compute';

describe('computeDiff', () => {
  it('computes diff for edit_file', () => {
    const result = computeDiff('a\nb\nc', 'a\nB\nc');
    expect(result.diff).toContain('-b');
    expect(result.diff).toContain('+B');
    expect(result.insertions).toBe(1);
    expect(result.deletions).toBe(1);
  });

  it('computes diff for new file (write_file)', () => {
    const result = computeDiff('', '# Title\n\nHello');
    expect(result.diff).toContain('+# Title');
    expect(result.diff).toContain('+Hello');
    expect(result.insertions).toBe(3);
    expect(result.deletions).toBe(0);
  });
});

describe('wrapUnifiedDiff', () => {
  it('wraps edit diff with unified diff headers', () => {
    const body = computeDiff('a\nb\nc', 'a\nB\nc').diff;
    const wrapped = wrapUnifiedDiff('src/utils.ts', 'a\nb\nc', body, 1, 1);
    expect(wrapped.filePath).toBe('src/utils.ts');
    expect(wrapped.diff).toContain('diff --git a/src/utils.ts b/src/utils.ts');
    expect(wrapped.diff).toContain('--- a/src/utils.ts');
    expect(wrapped.diff).toContain('+++ b/src/utils.ts');
    expect(wrapped.diff).toContain('-b');
    expect(wrapped.diff).toContain('+B');
    expect(wrapped.insertions).toBe(1);
    expect(wrapped.deletions).toBe(1);
  });

  it('wraps new file diff with /dev/null header', () => {
    const body = computeDiff('', '# Title\n\nHello').diff;
    const wrapped = wrapUnifiedDiff('README.md', '', body, 3, 0);
    expect(wrapped.diff).toContain('new file mode 100644');
    expect(wrapped.diff).toContain('--- /dev/null');
    expect(wrapped.diff).toContain('+++ b/README.md');
    expect(wrapped.insertions).toBe(3);
    expect(wrapped.deletions).toBe(0);
  });

  it('returns empty diff when no changes', () => {
    const wrapped = wrapUnifiedDiff('file.txt', 'same', ' same', 0, 0);
    expect(wrapped.diff).toBe('');
    expect(wrapped.insertions).toBe(0);
    expect(wrapped.deletions).toBe(0);
  });
});
