// @ts-nocheck
export interface DiffResult {
  filePath: string;
  diff: string;
  insertions: number;
  deletions: number;
}

export function computeDiff(
  oldContent: string,
  newContent: string
): { diff: string; insertions: number; deletions: number } {
  // New file shortcut: no LCS needed, everything is an insertion
  if (oldContent === '') {
    const newLines = newContent.split('\n');
    const diffLines: string[] = [];
    let insertions = 0;
    for (const line of newLines) {
      diffLines.push(`+${line}`);
      insertions++;
    }
    return { diff: diffLines.join('\n'), insertions, deletions: 0 };
  }

  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  // Simple LCS-based diff
  const m = oldLines.length;
  const n = newLines.length;

  // Build LCS table
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0)) as number[][];

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  // Backtrack to find diff
  const diffLines: string[] = [];
  let i = m,
    j = n;
  let insertions = 0,
    deletions = 0;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      diffLines.unshift(` ${oldLines[i - 1]}`);
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      diffLines.unshift(`+${newLines[j - 1]}`);
      insertions++;
      j--;
    } else {
      diffLines.unshift(`-${oldLines[i - 1]}`);
      deletions++;
      i--;
    }
  }

  return {
    diff: diffLines.join('\n'),
    insertions,
    deletions,
  };
}

export function wrapUnifiedDiff(
  relPath: string,
  oldContent: string,
  diffBody: string,
  insertions: number,
  deletions: number
): DiffResult {
  if (insertions === 0 && deletions === 0) {
    return { filePath: relPath, diff: '', insertions: 0, deletions: 0 };
  }
  const isNewFile = oldContent === '';
  const oldLines = oldContent.split('\n');
  const newLines = diffBody
    .split('\n')
    .filter((l) => l.startsWith('+') || l.startsWith(' '))
    .map((l) => l.slice(1));
  const headerLines = [
    `diff --git a/${relPath} b/${relPath}`,
    ...(isNewFile ? ['new file mode 100644'] : []),
    isNewFile ? '--- /dev/null' : `--- a/${relPath}`,
    `+++ b/${relPath}`,
    `@@ -${isNewFile ? 0 : 1},${isNewFile ? 0 : oldLines.length} +1,${newLines.length} @@`,
  ];
  return {
    filePath: relPath,
    diff: headerLines.join('\n') + '\n' + diffBody,
    insertions,
    deletions,
  };
}

export function buildToolDiff(
  result: Record<string, unknown> & { type: 'tool_result'; name?: string },
  callItem: Record<string, unknown> & { type: 'tool_call'; args?: Record<string, unknown> }
): Record<string, unknown> & { type: 'tool_result'; name?: string } {
  if (result.name !== 'edit_file' && result.name !== 'write_file') return result;
  const args = callItem.args ?? {};
  const rawPath = args.path as string | undefined;
  if (
    result.name === 'edit_file' &&
    rawPath &&
    typeof args.old_string === 'string' &&
    typeof args.new_string === 'string'
  ) {
    const r = computeDiff(args.old_string, args.new_string);
    if (r.insertions > 0 || r.deletions > 0) {
      const w = wrapUnifiedDiff(rawPath, args.old_string, r.diff, r.insertions, r.deletions);
      return {
        ...result,
        diff: w.diff,
        filePath: w.filePath,
        insertions: w.insertions,
        deletions: w.deletions,
      };
    }
  } else if (result.name === 'write_file' && rawPath && typeof args.content === 'string') {
    const r = computeDiff('', args.content);
    if (r.insertions > 0 || r.deletions > 0) {
      const w = wrapUnifiedDiff(rawPath, '', r.diff, r.insertions, r.deletions);
      return {
        ...result,
        diff: w.diff,
        filePath: w.filePath,
        insertions: w.insertions,
        deletions: w.deletions,
      };
    }
  }
  return result;
}
