import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { HookService } from '../hooks/registry.js';
import { Ledger } from './ledger.js';

/**
 * In-memory mapping: sessionId → currentTurnId.
 * Updated by orchestration when incrementTurn is called.
 * Read by hook observers to tag Ledger entries.
 */
export const turnIdBySession = new Map<string, number>();

/** Track whether bootstrap has already run for this hook service. */
const bootstrappedHooks = new WeakSet<HookService>();

/**
 * Register hook observers that record file-modifying tool calls to the Ledger.
 * Idempotent — safe to call multiple times with the same HookService.
 */
export function bootstrapCheckpoint(
  hooks: HookService,
  projectPath: string,
): void {
  if (bootstrappedHooks.has(hooks)) return;
  bootstrappedHooks.add(hooks);

  const normalizedPath = projectPath.replace(/\\/g, '/');
  const projectHash = createHash('sha256').update(normalizedPath).digest('hex').slice(0, 16);
  const shadowDir = join(homedir(), '.codingcode', 'checkpoints', `${projectHash}.git`);
  const ledger = new Ledger(shadowDir);

  // Pre-execution: record file hash before modification
  hooks.register('tool.execute.before', async (payload) => {
    const toolName = payload.toolName as string;
    if (toolName !== 'edit_file' && toolName !== 'write_file') return;

    const args = payload.args as Record<string, unknown> | undefined;
    const path = args?.path as string | undefined;
    if (!path) return;

    const beforeHash = fileHash(path);
    (payload as any)._ledgerHashBefore = beforeHash;
  });

  // Post-execution: record the full entry
  hooks.register('tool.execute.after', async (payload) => {
    const sessionId = payload.sessionId as string | undefined;
    if (!sessionId) return;
    const turnId = turnIdBySession.get(sessionId);
    if (turnId === undefined) return;

    const toolName = payload.toolName as string;
    const args = payload.args as Record<string, unknown> | undefined;
    const path = args?.path as string | undefined;
    if (!path) return;

    const hashBefore = (payload as any)._ledgerHashBefore as string ?? '';
    const hashAfter = fileHash(path);

    ledger.record({
      turnId,
      sessionId,
      type: toolName,
      path,
      hashBefore,
      hashAfter,
      timestamp: new Date().toISOString(),
    });
  });
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
