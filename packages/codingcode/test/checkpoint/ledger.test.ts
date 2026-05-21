import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { Ledger } from '../../src/checkpoint/ledger.js';

describe('Ledger', () => {
  let shadowDir: string;
  let ledger: Ledger;

  beforeEach(() => {
    // Use a temp path that looks like a git dir path — Ledger derives storage from it
    const hash = randomUUID().slice(0, 8);
    shadowDir = join(tmpdir(), `ledger-test-${hash}.git`);
    ledger = new Ledger(shadowDir);
  });

  afterEach(() => {
    // Clean up the ledger file
    const ledgerFile = shadowDir.replace('.git', '-ledger.jsonl');
    try { rmSync(ledgerFile, { force: true }); } catch { /* ignore */ }
  });

  it('records and retrieves entries', () => {
    ledger.record({ turnId: 1, sessionId: 's1', type: 'edit_file', path: 'src/a.ts', hashBefore: 'abc', hashAfter: 'def', timestamp: '2026-01-01T00:00:00Z' });
    ledger.record({ turnId: 1, sessionId: 's1', type: 'write_file', path: 'src/b.ts', hashBefore: '', hashAfter: 'ghi', timestamp: '2026-01-01T00:00:01Z' });

    const all = ledger.getForTurn(1, 's1');
    expect(all.length).toBe(2);
  });

  it('getAgentFiles returns only edit_file/write_file paths', () => {
    ledger.record({ turnId: 1, sessionId: 's1', type: 'edit_file', path: 'src/a.ts', hashBefore: 'abc', hashAfter: 'def', timestamp: '' });
    ledger.record({ turnId: 1, sessionId: 's1', type: 'bash', path: 'src/b.ts', hashBefore: '', hashAfter: '', timestamp: '' });
    ledger.record({ turnId: 1, sessionId: 's1', type: 'write_file', path: 'src/c.ts', hashBefore: '', hashAfter: 'ghi', timestamp: '' });

    const agentFiles = ledger.getAgentFiles(1, 's1');
    expect(agentFiles).toEqual(['src/a.ts', 'src/c.ts']);
  });

  it('separates turns by turnId and sessionId', () => {
    ledger.record({ turnId: 1, sessionId: 's1', type: 'edit_file', path: 'a.ts', hashBefore: '', hashAfter: '', timestamp: '' });
    ledger.record({ turnId: 2, sessionId: 's1', type: 'edit_file', path: 'b.ts', hashBefore: '', hashAfter: '', timestamp: '' });
    ledger.record({ turnId: 1, sessionId: 's2', type: 'write_file', path: 'c.ts', hashBefore: '', hashAfter: '', timestamp: '' });

    expect(ledger.getForTurn(1, 's1').length).toBe(1);
    expect(ledger.getForTurn(2, 's1').length).toBe(1);
    expect(ledger.getForTurn(1, 's2').length).toBe(1);
  });
});
