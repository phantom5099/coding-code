export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  oldLineNum: number | null;
  newLineNum: number | null;
  text: string;
}

export interface DiffHunk {
  oldStart: number;
  oldLen: number;
  newStart: number;
  newLen: number;
  lines: DiffLine[];
}

export interface ParsedDiffFile {
  fileName: string;
  hunks: DiffHunk[];
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedDiff(raw: string): ParsedDiffFile[] {
  const lines = raw.trimEnd().split('\n');
  const files: ParsedDiffFile[] = [];

  let currentFile: ParsedDiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldLineNum = 0;
  let newLineNum = 0;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line === undefined) {
      i++;
      continue;
    }

    // File header
    if (line.startsWith('diff --git a/') || line.startsWith('diff --git "a/')) {
      if (currentFile) files.push(currentFile);
      const match =
        line.match(/^diff --git a\/(.*?) b\/(.*?)$/) ??
        line.match(/^diff --git "a\/(.*?)" "b\/(.*?)"$/);
      currentFile = {
        fileName: match?.[2] ?? '',
        hunks: [],
      };
      currentHunk = null;
      i++;
      continue;
    }

    // Skip metadata lines (outside hunks)
    if (
      !currentHunk &&
      (line.startsWith('index ') ||
        line.startsWith('--- ') ||
        line.startsWith('+++ ') ||
        line.startsWith('new file mode ') ||
        line.startsWith('deleted file mode ') ||
        line.startsWith('similarity index ') ||
        line.startsWith('rename from ') ||
        line.startsWith('rename to ') ||
        line.startsWith('Binary files '))
    ) {
      i++;
      continue;
    }

    // Hunk header
    const hunkMatch = HUNK_HEADER_RE.exec(line);
    if (hunkMatch) {
      if (currentHunk && currentFile) currentFile.hunks.push(currentHunk);
      oldLineNum = parseInt(hunkMatch[1]!, 10);
      newLineNum = parseInt(hunkMatch[3]!, 10);
      currentHunk = {
        oldStart: oldLineNum,
        oldLen: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
        newStart: newLineNum,
        newLen: hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1,
        lines: [],
      };
      i++;
      continue;
    }

    if (!currentHunk) {
      i++;
      continue;
    }

    // Diff lines
    const prefix = line.charAt(0);
    let type: DiffLine['type'];
    let oldNum: number | null = null;
    let newNum: number | null = null;
    const text = line.slice(1); // Remove +/- prefix

    if (prefix === '+') {
      type = 'add';
      newNum = newLineNum;
      newLineNum++;
    } else if (prefix === '-') {
      type = 'remove';
      oldNum = oldLineNum;
      oldLineNum++;
    } else {
      type = 'context';
      oldNum = oldLineNum;
      newNum = newLineNum;
      oldLineNum++;
      newLineNum++;
    }

    currentHunk.lines.push({ type, oldLineNum: oldNum, newLineNum: newNum, text });
    i++;
  }

  if (currentHunk && currentFile) currentFile.hunks.push(currentHunk);
  if (currentFile) files.push(currentFile);

  return files;
}

export function isEmptyDiff(raw: string): boolean {
  return !raw || raw.trim().length === 0 || parseUnifiedDiff(raw).length === 0;
}
