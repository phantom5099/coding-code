import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { buildMessages } from '../../src/session/store.js';
import type { SessionIndex } from '../../src/session/types.js';

const PROJECT_BASE = join(homedir(), '.codingcode', 'project');

function makeFixture(sessionId: string, slug: string) {
  const dir = join(PROJECT_BASE, slug, 'sessions');
  mkdirSync(dir, { recursive: true });
  const transcriptPath = join(dir, `${sessionId}.jsonl`);
  const indexPath = join(dir, `${sessionId}.index.json`);

  const lines: any[] = [
    { type: 'session_meta', sessionId, projectPath: slug, cwd: '/tmp/test', model: 'test', createdAt: new Date().toISOString(), version: '0.1.0' },
    { type: 'user', turnId: 1, uuid: 'u1', content: 'hello', timestamp: new Date().toISOString() },
    { type: 'assistant', turnId: 1, uuid: 'a1', content: 'hi', toolCalls: [], model: 'test', timestamp: new Date().toISOString() },
    { type: 'user', turnId: 2, uuid: 'u2', content: 'oops wrong message', timestamp: new Date().toISOString() },
    { type: 'assistant', turnId: 2, uuid: 'a2', content: 'ok', toolCalls: [], model: 'test', timestamp: new Date().toISOString() },
    { type: 'user', turnId: 3, uuid: 'u3', content: 'correct message', timestamp: new Date().toISOString() },
    { type: 'assistant', turnId: 3, uuid: 'a3', content: 'got it', toolCalls: [], model: 'test', timestamp: new Date().toISOString() },
  ];

  writeFileSync(transcriptPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

  const idx: SessionIndex = {
    sessionId, projectPath: slug, cwd: '/tmp/test', model: 'test',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    messageCount: 6, title: 'fixture', currentTurnId: 3,
    usage: undefined, permissionMode: 'default',
  };
  writeFileSync(indexPath, JSON.stringify(idx, null, 2), 'utf8');

  return { dir, transcriptPath, indexPath };
}

import { appendFileSync } from 'fs';

describe('hideMessage and unhide', () => {
  it('hide message removes it from the view', () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const fx = makeFixture(sessionId, slug);
    try {
      // Hide u2 ("oops wrong message")
      appendFileSync(fx.transcriptPath, JSON.stringify({
        type: 'hide', uuid: randomUUID(), kind: 'message', targetUuid: 'u2',
        reason: 'user deleted', timestamp: new Date().toISOString(),
      }) + '\n', 'utf8');

      const messages = buildMessages(fx.transcriptPath);
      const userContents = messages.filter((m) => m.role === 'user').map((m) => m.content);
      expect(userContents).toEqual(['hello', 'correct message']);
      expect(userContents).not.toContain('oops wrong message');
    } finally { rmSync(join(PROJECT_BASE, slug), { recursive: true, force: true }); }
  });

  it('unhide restores the hidden message', () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const fx = makeFixture(sessionId, slug);
    try {
      const hideUuid = randomUUID();
      appendFileSync(fx.transcriptPath, JSON.stringify({
        type: 'hide', uuid: hideUuid, kind: 'message', targetUuid: 'u2',
        reason: 'user deleted', timestamp: new Date().toISOString(),
      }) + '\n', 'utf8');

      appendFileSync(fx.transcriptPath, JSON.stringify({
        type: 'unhide', uuid: randomUUID(), targetHideUuid: hideUuid,
        timestamp: new Date().toISOString(),
      }) + '\n', 'utf8');

      const messages = buildMessages(fx.transcriptPath);
      const userContents = messages.filter((m) => m.role === 'user').map((m) => m.content);
      expect(userContents).toEqual(['hello', 'oops wrong message', 'correct message']);
    } finally { rmSync(join(PROJECT_BASE, slug), { recursive: true, force: true }); }
  });

  it('hiding an assistant message also removes it', () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const fx = makeFixture(sessionId, slug);
    try {
      appendFileSync(fx.transcriptPath, JSON.stringify({
        type: 'hide', uuid: randomUUID(), kind: 'message', targetUuid: 'a2',
        reason: 'user deleted', timestamp: new Date().toISOString(),
      }) + '\n', 'utf8');

      const messages = buildMessages(fx.transcriptPath);
      const assistantContents = messages.filter((m) => m.role === 'assistant').map((m) => m.content);
      expect(assistantContents).toEqual(['hi', 'got it']);
      expect(assistantContents).not.toContain('ok');
    } finally { rmSync(join(PROJECT_BASE, slug), { recursive: true, force: true }); }
  });
});
