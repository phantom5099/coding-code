import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { buildMessages } from '../../src/session/messages.js';
import type { SessionIndex, SessionEvent } from '../../src/session/types.js';

const PROJECT_BASE = join(homedir(), '.codingcode', 'project');

function makeFixture(sessionId: string, slug: string) {
  const dir = join(PROJECT_BASE, slug, 'sessions');
  mkdirSync(dir, { recursive: true });
  const transcriptPath = join(dir, `${sessionId}.jsonl`);
  const indexPath = join(dir, `${sessionId}.index.json`);

  const lines: any[] = [
    {
      type: 'session_meta',
      sessionId,
      projectPath: slug,
      cwd: '/tmp/test',
      model: 'test',
      createdAt: new Date().toISOString(),
    },
    { type: 'user', turnId: 1, uuid: 'u1', content: 'hello', timestamp: new Date().toISOString() },
    {
      type: 'assistant',
      turnId: 1,
      uuid: 'a1',
      content: 'hi',
      toolCalls: [],
      model: 'test',
      timestamp: new Date().toISOString(),
    },
    {
      type: 'user',
      turnId: 2,
      uuid: 'u2',
      content: 'do stuff',
      timestamp: new Date().toISOString(),
    },
    {
      type: 'assistant',
      turnId: 2,
      uuid: 'a2',
      content: 'ok',
      toolCalls: [{ id: 'tc1', name: 'bash', arguments: '{}' }],
      model: 'test',
      timestamp: new Date().toISOString(),
    },
    {
      type: 'tool_result',
      turnId: 2,
      uuid: 't1',
      parentUuid: 'a2',
      toolName: 'bash',
      toolCallId: 'tc1',
      output: 'result',
      timestamp: new Date().toISOString(),
      tokenCount: 5,
    },
    { type: 'user', turnId: 3, uuid: 'u3', content: 'done', timestamp: new Date().toISOString() },
    {
      type: 'assistant',
      turnId: 3,
      uuid: 'a3',
      content: 'great',
      toolCalls: [],
      model: 'test',
      timestamp: new Date().toISOString(),
    },
  ];

  writeFileSync(transcriptPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

  const idx: SessionIndex = {
    sessionId,
    projectPath: slug,
    cwd: '/tmp/test',
    model: 'test',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: 7,
    title: 'fixture',
    currentTurnId: 3,
    usage: undefined,
    promptEstimate: 0,
    permissionMode: 'default',
  };
  writeFileSync(indexPath, JSON.stringify(idx, null, 2), 'utf8');

  return { dir, transcriptPath, indexPath };
}

function appendEvent(jsonlPath: string, event: object): void {
  appendFileSync(jsonlPath, JSON.stringify(event) + '\n', 'utf8');
}

import { appendFileSync } from 'fs';

describe('rollback and undo', () => {
  it('rollback hides events after the target turn', () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const fx = makeFixture(sessionId, slug);
    try {
      // Simulate rollback to turn 1
      appendEvent(fx.transcriptPath, {
        type: 'hide',
        uuid: randomUUID(),
        kind: 'rollback',
        throughTurnId: 1,
        reason: 'user rollback',
        timestamp: new Date().toISOString(),
      });

      const messages = buildMessages(fx.transcriptPath);
      const userContents = messages.filter((m) => m.role === 'user').map((m) => m.content);
      expect(userContents).toEqual([]);
    } finally {
      rmSync(join(PROJECT_BASE, slug), { recursive: true, force: true });
    }
  });

  it('undoLastHide restores the view after rollback', () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const fx = makeFixture(sessionId, slug);
    try {
      const hideUuid = randomUUID();
      // Rollback
      appendEvent(fx.transcriptPath, {
        type: 'hide',
        uuid: hideUuid,
        kind: 'rollback',
        throughTurnId: 1,
        reason: 'user rollback',
        timestamp: new Date().toISOString(),
      });
      // Undo
      appendEvent(fx.transcriptPath, {
        type: 'unhide',
        uuid: randomUUID(),
        targetHideUuid: hideUuid,
        timestamp: new Date().toISOString(),
      });

      const messages = buildMessages(fx.transcriptPath);
      const userContents = messages.filter((m) => m.role === 'user').map((m) => m.content);
      // All messages should be restored
      expect(userContents).toEqual(['hello', 'do stuff', 'done']);
    } finally {
      rmSync(join(PROJECT_BASE, slug), { recursive: true, force: true });
    }
  });

  it('view is byte-level consistent after rollback + undo', () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const fx = makeFixture(sessionId, slug);
    try {
      const before = buildMessages(fx.transcriptPath);

      const hideUuid = randomUUID();
      appendEvent(fx.transcriptPath, {
        type: 'hide',
        uuid: hideUuid,
        kind: 'rollback',
        throughTurnId: 2,
        reason: 'rollback',
        timestamp: new Date().toISOString(),
      });
      appendEvent(fx.transcriptPath, {
        type: 'unhide',
        uuid: randomUUID(),
        targetHideUuid: hideUuid,
        timestamp: new Date().toISOString(),
      });

      const after = buildMessages(fx.transcriptPath);
      expect(after).toEqual(before);
    } finally {
      rmSync(join(PROJECT_BASE, slug), { recursive: true, force: true });
    }
  });
});
