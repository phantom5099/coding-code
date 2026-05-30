import { Effect } from 'effect';
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import type { HookService } from '../hooks/registry.js';
import { encodeProjectPath } from '../core/path.js';
import { getWorkspaceCwd } from '../core/workspace.js';
import { Ledger } from './ledger.js';

/** Cache ledger instances by checkpoint directory path. */
const ledgerCache = new Map<string, Ledger>();

/**
 * Carry file hash from tool.execute.before to tool.execute.after.
 * Keyed by execId (unique per tool execution) to avoid parallel race conditions.
 */
const pendingHash = new Map<string, string>();

function getLedger(projectPath: string): Ledger {
  const encoded = encodeProjectPath(projectPath);
  const checkpointDir = join(homedir(), '.codingcode', 'project', encoded, 'checkpoint');
  let ledger = ledgerCache.get(checkpointDir);
  if (!ledger) {
    ledger = new Ledger(checkpointDir);
    ledgerCache.set(checkpointDir, ledger);
  }
  return ledger;
}

/**
 * Register hook observers that record file-modifying tool calls to the Ledger.
 * Uses source: 'system' so these hooks survive reloadUserHooks() calls.
 * Idempotent — safe to call multiple times with the same HookService.
 */
export function bootstrapCheckpoint(
  hooks: HookService,
): void {
  // Pre-execution: record file hash before modification
  Effect.runSync(hooks.register('tool.execute.before', async (payload) => {
    const toolName = payload.toolName as string;
    if (toolName !== 'edit_file' && toolName !== 'write_file') return;

    const args = payload.args as Record<string, unknown> | undefined;
    const rawPath = args?.path as string | undefined;
    if (!rawPath) return;

    const base = (payload.projectPath as string | undefined) || getWorkspaceCwd();
    const resolvedPath = resolve(base, rawPath);
    const execId = payload.execId as string;
    if (execId) {
      pendingHash.set(execId, fileHash(resolvedPath));
    }
  }, { source: 'system' }));

  // Post-execution: record the full entry
  Effect.runSync(hooks.register('tool.execute.after', async (payload) => {
    const sessionId = payload.sessionId as string | undefined;
    if (!sessionId) return;
    const turnId = payload.turnId as number | undefined;
    if (turnId === undefined) return;
    const projectPath = payload.projectPath as string | undefined;
    if (!projectPath) return;

    const toolName = payload.toolName as string;
    if (toolName !== 'edit_file' && toolName !== 'write_file') return;

    const args = payload.args as Record<string, unknown> | undefined;
    const rawPath = args?.path as string | undefined;
    if (!rawPath) return;
    const base = (payload.projectPath as string | undefined) || getWorkspaceCwd();
    const resolvedPath = resolve(base, rawPath);

    const execId = payload.execId as string;
    const hashBefore = execId ? (pendingHash.get(execId) ?? '') : '';
    if (execId) {
      pendingHash.delete(execId);
    }

    const hashAfter = fileHash(resolvedPath);

    getLedger(projectPath).record({
      turnId,
      sessionId,
      type: toolName,
      path: resolvedPath,
      hashBefore,
      hashAfter,
      timestamp: new Date().toISOString(),
    });
  }, { source: 'system' }));
}

function fileHash(filePath: string): string {
  try {
    if (!existsSync(filePath)) return '';
    const content = readFileSync(filePath);
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  } catch {
    return '';
  }
}
