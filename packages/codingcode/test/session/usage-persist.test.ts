import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { findSessionIndex } from '../../src/session/store.js';
import type { SessionIndex } from '../../src/session/types.js';

const PROJECT_BASE = join(homedir(), '.codingcode', 'project');

function makeFixture(sessionId: string, slug: string, usage?: { prompt: number; completion: number; total: number }) {
  const dir = join(PROJECT_BASE, slug, 'sessions');
  mkdirSync(dir, { recursive: true });
  const transcriptPath = join(dir, `${sessionId}.jsonl`);
  const indexPath = join(dir, `${sessionId}.index.json`);

  const meta = { type: 'session_meta', sessionId, projectPath: slug, cwd: '/tmp/test', model: 'test', createdAt: new Date().toISOString(), version: '0.1.0' };
  writeFileSync(transcriptPath, JSON.stringify(meta) + '\n', 'utf8');

  const idx: SessionIndex = {
    sessionId, projectPath: slug, cwd: '/tmp/test', model: 'test',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    messageCount: 0, title: 'test', currentTurnId: 0,
    usage: usage as any, permissionMode: 'default',
  };
  writeFileSync(indexPath, JSON.stringify(idx, null, 2), 'utf8');

  return { dir, indexPath };
}

describe('session usage persist', () => {
  it('findSessionIndex reads usage from index.json', () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const usage = { prompt: 1000, completion: 500, total: 1500 };
    const fx = makeFixture(sessionId, slug, usage);
    try {
      const idx = findSessionIndex(sessionId);
      expect(idx).not.toBeNull();
      expect(idx!.usage).toEqual(usage);
    } finally { rmSync(join(PROJECT_BASE, slug), { recursive: true, force: true }); }
  });

  it('findSessionIndex returns undefined usage when not present', () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const fx = makeFixture(sessionId, slug);
    try {
      const idx = findSessionIndex(sessionId);
      expect(idx).not.toBeNull();
      expect(idx!.usage).toBeUndefined();
    } finally { rmSync(join(PROJECT_BASE, slug), { recursive: true, force: true }); }
  });
});
