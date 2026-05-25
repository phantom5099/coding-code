import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { Ledger } from '../../src/checkpoint/ledger.js';

describe('Ledger', () => {
  let checkpointDir: string;
  let ledger: Ledger;

  beforeEach(() => {
    checkpointDir = join(tmpdir(), `ledger-test-${randomUUID().slice(0, 8)}`);
    mkdirSync(checkpointDir, { recursive: true });
    ledger = new Ledger(checkpointDir);
  });

  afterEach(() => {
    try { rmSync(join(checkpointDir, 'repo-ledger.jsonl'), { force: true }); } catch { /* ignore */ }
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
