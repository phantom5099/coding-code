import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { forkSession, buildMessages } from '../../src/session/store.js';
import type { SessionIndex, SessionEvent } from '../../src/session/types.js';

const PROJECT_BASE = join(homedir(), '.codingcode', 'project');

function makeFixture(sessionId: string, slug: string) {
  const dir = join(PROJECT_BASE, slug, 'sessions');
  mkdirSync(dir, { recursive: true });
  const transcriptPath = join(dir, `${sessionId}.jsonl`);
  const indexPath = join(dir, `${sessionId}.index.json`);

  const lines: any[] = [
    { type: 'session_meta', sessionId, projectPath: slug, cwd: '/tmp/test', model: 'test', createdAt: new Date().toISOString(), version: '0.1.0' },
    { type: 'user', turnId: 1, uuid: 'u1', content: 'first', timestamp: new Date().toISOString() },
    { type: 'assistant', turnId: 1, uuid: 'a1', content: 'reply1', toolCalls: [], model: 'test', timestamp: new Date().toISOString() },
    { type: 'user', turnId: 2, uuid: 'u2', content: 'second', timestamp: new Date().toISOString() },
    { type: 'assistant', turnId: 2, uuid: 'a2', content: 'reply2', toolCalls: [{ id: 'tc1', name: 'bash', arguments: '{}' }], model: 'test', timestamp: new Date().toISOString() },
    { type: 'tool_result', turnId: 2, uuid: 't1', parentUuid: 'a2', toolName: 'bash', toolCallId: 'tc1', output: 'cmd output', timestamp: new Date().toISOString(), tokenCount: 5 },
    { type: 'user', turnId: 3, uuid: 'u3', content: 'third', timestamp: new Date().toISOString() },
    { type: 'assistant', turnId: 3, uuid: 'a3', content: 'reply3', toolCalls: [], model: 'test', timestamp: new Date().toISOString() },
  ];

  writeFileSync(transcriptPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

  const idx: SessionIndex = {
    sessionId, projectPath: slug, cwd: '/tmp/test', model: 'test',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    messageCount: 7, title: 'fixture', currentTurnId: 3,
    usage: undefined, permissionMode: 'default',
  };
  writeFileSync(indexPath, JSON.stringify(idx, null, 2), 'utf8');

  return { dir, transcriptPath, indexPath };
}

function readEvents(jsonlPath: string): SessionEvent[] {
  const content = readFileSync(jsonlPath, 'utf8');
  return content.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as SessionEvent);
}

describe('forkSession', () => {
  it('fork copies events from root to atUuid', () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const fx = makeFixture(sessionId, slug);
    try {
      // Fork at u2 (turn 2 start)
      const newSessionId = forkSession(sessionId, fx.transcriptPath, 'u2');
      const newJsonlPath = join(fx.dir, `${newSessionId}.jsonl`);
      expect(existsSync(newJsonlPath)).toBe(true);

      const newEvents = readEvents(newJsonlPath);
      // Should have: session_meta + u1 + a1 + u2 = 4 events
      expect(newEvents).toHaveLength(4);
      expect(newEvents[0]!.type).toBe('session_meta');
      expect((newEvents[0] as any).sessionId).toBe(newSessionId);
      expect((newEvents[1] as any).content).toBe('first');
      expect((newEvents[2] as any).content).toBe('reply1');
      expect((newEvents[3] as any).content).toBe('second');
    } finally { rmSync(join(PROJECT_BASE, slug), { recursive: true, force: true }); }
  });

  it('forked session has new UUIDs', () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const fx = makeFixture(sessionId, slug);
    try {
      const newSessionId = forkSession(sessionId, fx.transcriptPath, 'u2');
      const newJsonlPath = join(fx.dir, `${newSessionId}.jsonl`);
      const newEvents = readEvents(newJsonlPath);

      const originalEvents = readEvents(fx.transcriptPath);
      const originalUuids = new Set(originalEvents.filter((e) => 'uuid' in e).map((e) => (e as any).uuid));
      const newUuids = newEvents.filter((e) => 'uuid' in e).map((e) => (e as any).uuid);

      // No UUID overlap
      for (const u of newUuids) {
        expect(originalUuids.has(u)).toBe(false);
      }
    } finally { rmSync(join(PROJECT_BASE, slug), { recursive: true, force: true }); }
  });

  it('deleting events in forked session does not affect source', () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const fx = makeFixture(sessionId, slug);
    try {
      const newSessionId = forkSession(sessionId, fx.transcriptPath, 'u2');
      const newJsonlPath = join(fx.dir, `${newSessionId}.jsonl`);

      // Append a hide event in the forked session
      const newEvents = readEvents(newJsonlPath);
      const targetUuid = (newEvents[1] as any).uuid; // first user event in fork
      writeFileSync(newJsonlPath, readFileSync(newJsonlPath, 'utf8') + JSON.stringify({
        type: 'hide', uuid: randomUUID(), kind: 'message', targetUuid,
        reason: 'deleted in fork', timestamp: new Date().toISOString(),
      }) + '\n', 'utf8');

      // Source should be unaffected
      const sourceMessages = buildMessages(fx.transcriptPath);
      const sourceUserContents = sourceMessages.filter((m) => m.role === 'user').map((m) => m.content);
      expect(sourceUserContents).toEqual(['first', 'second', 'third']);

      // Fork should reflect the hide
      const forkMessages = buildMessages(newJsonlPath);
      const forkUserContents = forkMessages.filter((m) => m.role === 'user').map((m) => m.content);
      expect(forkUserContents).toEqual(['second']);
    } finally { rmSync(join(PROJECT_BASE, slug), { recursive: true, force: true }); }
  });

  it('fork creates index.json with correct metadata', () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const fx = makeFixture(sessionId, slug);
    try {
      const newSessionId = forkSession(sessionId, fx.transcriptPath, 'a1');
      const newIndexPath = join(fx.dir, `${newSessionId}.index.json`);
      expect(existsSync(newIndexPath)).toBe(true);

      const idx = JSON.parse(readFileSync(newIndexPath, 'utf8')) as SessionIndex;
      expect(idx.sessionId).toBe(newSessionId);
      expect(idx.title).toBe('fixture');
      expect(idx.permissionMode).toBe('default');
    } finally { rmSync(join(PROJECT_BASE, slug), { recursive: true, force: true }); }
  });
});
