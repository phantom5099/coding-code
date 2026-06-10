import { Effect } from 'effect';
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import type { HookService } from '../hooks/registry.js';
import { encodeProjectPath } from '../core/path.js';

import { Ledger } from './ledger.js';

/**
 * Carry file hash from tool.execute.before to tool.execute.after.
 * Keyed by execId (unique per tool execution) to avoid parallel race conditions.
 */
const hashBeforeEdit = new Map<string, string>();

function getLedger(projectPath: string): Ledger {
  const encoded = encodeProjectPath(projectPath);
  const checkpointDir = join(homedir(), '.codingcode', 'project', encoded, 'checkpoint');
  return new Ledger(checkpointDir);
}

/**
 * Register hook observers that record file-modifying tool calls to the Ledger.
 * Uses source: 'system' so these hooks survive reloadUserHooks() calls.
 * Idempotent — safe to call multiple times with the same HookService.
 */
export function registerCheckpointHooks(hooks: HookService): void {
  // Pre-execution: record file hash before modification
  Effect.runSync(
    hooks.register(
      'tool.execute.before',
      async (payload) => {
        const toolName = payload.toolName as string;
        if (toolName !== 'edit_file' && toolName !== 'write_file') return;

        const args = payload.args as Record<string, unknown> | undefined;
        const rawPath = args?.path as string | undefined;
        if (!rawPath) return;

        const base = (payload.projectPath as string | undefined) || process.cwd();
        const resolvedPath = resolve(base, rawPath);
        const callId = payload.callId as string;
        if (callId) {
          hashBeforeEdit.set(callId, sha256Truncated(resolvedPath));
        }
      },
      { source: 'system' }
    )
  );

  // Post-execution: record the full entry
  Effect.runSync(
    hooks.register(
      'tool.execute.after',
      async (payload) => {
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
        const base = (payload.projectPath as string | undefined) || process.cwd();
        const resolvedPath = resolve(base, rawPath);

        const callId = payload.callId as string;
        const hashBefore = callId ? (hashBeforeEdit.get(callId) ?? '') : '';
        if (callId) {
          hashBeforeEdit.delete(callId);
        }

        const hashAfter = sha256Truncated(resolvedPath);

        getLedger(projectPath).record({
          turnId,
          sessionId,
          type: toolName,
          path: resolvedPath,
          hashBefore,
          hashAfter,
          timestamp: new Date().toISOString(),
        });
      },
      { source: 'system' }
    )
  );
}

function sha256Truncated(filePath: string): string {
  try {
    if (!existsSync(filePath)) return '';
    const content = readFileSync(filePath);
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  } catch {
    return '';
  }
}
