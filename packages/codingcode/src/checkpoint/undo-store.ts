import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { CodeRestoreEntry } from './types.js';
import { shortSid } from './utils.js';

function restorePath(gitDir: string, sessionId: string): string {
  return join(gitDir, '..', `last-restore-${shortSid(sessionId)}.json`);
}

export function readRestoreEntry(gitDir: string, sessionId: string): CodeRestoreEntry | null {
  const path = restorePath(gitDir, sessionId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as CodeRestoreEntry;
  } catch {
    return null;
  }
}

export function writeRestoreEntry(
  gitDir: string,
  sessionId: string,
  entry: CodeRestoreEntry | null
): void {
  const path = restorePath(gitDir, sessionId);
  if (!entry) {
    try {
      unlinkSync(path);
    } catch {
      /* ignore */
    }
  } else {
    writeFileSync(path, JSON.stringify(entry, null, 2), 'utf8');
  }
}
