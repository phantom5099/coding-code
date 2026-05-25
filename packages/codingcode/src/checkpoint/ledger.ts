import { existsSync, appendFileSync, readFileSync } from 'fs';
import { join } from 'path';

export interface LedgerEntry {
  turnId: number;
  sessionId: string;
  type: string;
  path: string;
  hashBefore: string;
  hashAfter: string;
  timestamp: string;
}

/**
 * File change ledger — JSONL log of every file-modifying tool call.
 * Stored inside the project checkpoint folder: project/<encoded>/checkpoint/repo-ledger.jsonl
 */
export class Ledger {
  private readonly path: string;

  constructor(checkpointDir: string) {
    this.path = join(checkpointDir, 'repo-ledger.jsonl');
  }

  record(entry: LedgerEntry): void {
    appendFileSync(this.path, JSON.stringify(entry) + '\n', 'utf8');
  }

  /** All ledger entries for a given turn */
  getForTurn(turnId: number, sessionId: string): LedgerEntry[] {
    return this.readAll().filter((e) => e.turnId === turnId && e.sessionId === sessionId);
  }

  /** File paths that were explicitly modified by edit_file / write_file in a turn */
  getAgentFiles(turnId: number, sessionId: string): string[] {
    return this.getForTurn(turnId, sessionId)
      .filter((e) => e.type === 'edit_file' || e.type === 'write_file')
      .map((e) => e.path);
  }

  private readAll(): LedgerEntry[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LedgerEntry);
  }
}
