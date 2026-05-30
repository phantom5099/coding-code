import { describe, it, expect } from 'vitest';
import { computeDiff } from '../../src/checkpoint/diff-tracker.js';

function wrapUnifiedDiff(relPath: string, oldContent: string, diffBody: string, insertions: number, deletions: number): { diff: string; insertions: number; deletions: number } {
  const isNewFile = oldContent === '';
  const oldLines = oldContent.split('\n');
  const newLines = diffBody.split('\n').filter((l) => l.startsWith('+') || l.startsWith(' ')).map((l) => l.slice(1));
  const headerLines = [
    `diff --git a/${relPath} b/${relPath}`,
    ...(isNewFile ? ['new file mode 100644'] : []),
    isNewFile ? '--- /dev/null' : `--- a/${relPath}`,
    `+++ b/${relPath}`,
    `@@ -${isNewFile ? 0 : 1},${isNewFile ? 0 : oldLines.length} +1,${newLines.length} @@`,
  ];
  return {
    diff: headerLines.join('\n') + '\n' + diffBody,
    insertions,
    deletions,
  };
}

describe('computeDiff', () => {
  it('new file: all lines are insertions', () => {
    const result = computeDiff('', '# Title\n\nContent line\n');
    expect(result.insertions).toBe(4);
    expect(result.deletions).toBe(0);
    expect(result.diff).toBe('+# Title\n+\n+Content line\n+');
  });

  it('edit file: computes additions and deletions', () => {
    const oldContent = 'line1\nline2\nline3';
    const newContent = 'line1\nline2\nline3 edited';
    const result = computeDiff(oldContent, newContent);
    expect(result.insertions).toBe(1);
    expect(result.deletions).toBe(1);
  });

  it('no change: zero insertions and deletions', () => {
    const content = 'unchanged';
    const result = computeDiff(content, content);
    expect(result.insertions).toBe(0);
    expect(result.deletions).toBe(0);
    expect(result.diff).toBe(' unchanged');
  });

  it('wrapped unified diff parses correctly for new file', () => {
    const relPath = 'README.md';
    const oldContent = '';
    const diffBody = computeDiff(oldContent, '# Hello\nWorld').diff;
    const wrapped = wrapUnifiedDiff(relPath, oldContent, diffBody, 2, 0);

    expect(wrapped.diff).toContain('diff --git a/README.md b/README.md');
    expect(wrapped.diff).toContain('new file mode 100644');
    expect(wrapped.diff).toContain('--- /dev/null');
    expect(wrapped.diff).toContain('+++ b/README.md');
    expect(wrapped.diff).toContain('@@ -0,0 +1,2 @@');
    expect(wrapped.diff).toContain('+# Hello');
    expect(wrapped.diff).toContain('+World');
  });

  it('wrapped unified diff parses correctly for edit', () => {
    const relPath = 'src/utils.ts';
    const oldContent = 'a\nb\nc';
    const newContent = 'a\nB\nc';
    const diffBody = computeDiff(oldContent, newContent).diff;
    const wrapped = wrapUnifiedDiff(relPath, oldContent, diffBody, 1, 1);

    expect(wrapped.diff).toContain('diff --git a/src/utils.ts b/src/utils.ts');
    expect(wrapped.diff).not.toContain('new file mode 100644');
    expect(wrapped.diff).toContain('--- a/src/utils.ts');
    expect(wrapped.diff).toContain('+++ b/src/utils.ts');
    expect(wrapped.diff).toContain('@@ -1,3 +1,3 @@');
    expect(wrapped.diff).toContain('-b');
    expect(wrapped.diff).toContain('+B');
    expect(wrapped.diff).toContain(' a');
    expect(wrapped.diff).toContain(' c');
  });
});
