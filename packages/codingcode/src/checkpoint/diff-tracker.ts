import { readFileSync } from 'fs';
import { relative, resolve } from 'path';
import { Effect } from 'effect';
import type { HookService } from '../hooks/registry.js';
import { getWorkspaceCwd } from '../core/workspace.js';

export interface DiffResult {
  filePath: string;
  diff: string;
  insertions: number;
  deletions: number;
}

const pendingContent = new Map<string, string>();
const pendingDiff = new Map<string, DiffResult>();

function computeDiff(oldContent: string, newContent: string): { diff: string; insertions: number; deletions: number } {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  
  // Simple LCS-based diff
  const m = oldLines.length;
  const n = newLines.length;
  
  // Build LCS table
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  
  // Backtrack to find diff
  const diffLines: string[] = [];
  let i = m, j = n;
  let insertions = 0, deletions = 0;
  
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      diffLines.unshift(` ${oldLines[i - 1]}`);
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
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

export function bootstrapDiffTracker(hooks: HookService): void {
  // before: record old file content
  Effect.runSync(hooks.register('tool.execute.before', async (payload) => {
    const toolName = payload.toolName as string;
    if (toolName !== 'edit_file' && toolName !== 'write_file') return;

    const args = payload.args as Record<string, unknown> | undefined;
    const rawPath = args?.path as string | undefined;
    if (!rawPath) return;

    const base = (payload.projectPath as string | undefined) || getWorkspaceCwd();
    const resolvedPath = resolve(base, rawPath);
    const callId = payload.callId as string;
    if (callId) {
      try {
        const oldContent = readFileSync(resolvedPath, 'utf-8');
        pendingContent.set(callId, oldContent);
      } catch {
        pendingContent.set(callId, '');
      }
    }
  }, { source: 'system' }));

  // after: compute diff
  Effect.runSync(hooks.register('tool.execute.after', async (payload) => {
    const toolName = payload.toolName as string;
    if (toolName !== 'edit_file' && toolName !== 'write_file') return;

    const args = payload.args as Record<string, unknown> | undefined;
    const rawPath = args?.path as string | undefined;
    if (!rawPath) return;

    const base = (payload.projectPath as string | undefined) || getWorkspaceCwd();
    const resolvedPath = resolve(base, rawPath);
    const relPath = relative(base, resolvedPath) || '.';

    const callId = payload.callId as string;
    const oldContent = callId ? (pendingContent.get(callId) ?? '') : '';
    if (callId) pendingContent.delete(callId);

    let newContent = '';
    try { newContent = readFileSync(resolvedPath, 'utf-8'); } catch {}

    const result = computeDiff(oldContent, newContent);

    if (callId && (result.insertions > 0 || result.deletions > 0)) {
      pendingDiff.set(callId, {
        filePath: relPath,
        diff: result.diff,
        insertions: result.insertions,
        deletions: result.deletions,
      });
    }
  }, { source: 'system' }));
}

export function getPendingDiff(callId: string): DiffResult | undefined {
  const diff = pendingDiff.get(callId);
  pendingDiff.delete(callId);
  return diff;
}
