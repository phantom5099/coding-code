import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { loadProjectionStore, appendProjection } from '../../src/session/projection-store.js';

const PROJECT_BASE = join(homedir(), '.codingcode', 'project');

describe('multi-session isolation', () => {
  it('concurrent sessions have independent projection stores', () => {
    const slug = randomUUID();
    const dir = join(PROJECT_BASE, slug, 'sessions');
    mkdirSync(dir, { recursive: true });

    const sids = [randomUUID(), randomUUID(), randomUUID()];
    for (const sid of sids) {
      writeFileSync(join(dir, `${sid}.jsonl`), '', 'utf8');
    }

    appendProjection(sids[0]!, {
      type: 'message',
      id: 'm1',
      targetEventUuid: 't1',
      replacement: { role: 'tool', content: '[cleared]' },
      originalTurnId: 1,
      method: 'prune',
      createdAt: new Date().toISOString(),
    });

    appendProjection(sids[1]!, {
      type: 'range',
      id: 'r1',
      turnRange: [1, 5],
      summaryMessages: [{ role: 'system', content: 'summary' }],
      method: 'auto-compact',
      createdAt: new Date().toISOString(),
    });

    const store0 = loadProjectionStore(sids[0]!);
    const store1 = loadProjectionStore(sids[1]!);
    const store2 = loadProjectionStore(sids[2]!);

    expect(store0.projections).toHaveLength(1);
    expect(store0.projections[0]!.type).toBe('message');
    expect(store1.projections).toHaveLength(1);
    expect(store1.projections[0]!.type).toBe('range');
    expect(store2.projections).toHaveLength(0);

    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });
});
