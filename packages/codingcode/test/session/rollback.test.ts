import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, appendFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { filterForContext, buildContextMessages } from '../../src/context/service.js';
import { readHistory } from '../../src/session/file-ops.js';
import type { SessionIndex } from '../../src/session/types.js';
import { useTempProjectBase } from '../helpers/project-base.js';

const base = useTempProjectBase();

function makeFixture(sessionId: string, slug: string) {
  const dir = join(base.dir, slug, 'sessions');
  mkdirSync(dir, { recursive: true });
  const transcriptPath = join(dir, `${sessionId}.jsonl`);
  const indexPath = join(dir, `${sessionId}.index.json`);

  const lines: any[] = [
    {
      type: 'session_meta',
      sessionId,
      projectPath: slug,
      cwd: '/tmp/test',
      createdAt: new Date().toISOString(),
    },
    { type: 'user', turnId: 1, content: 'hello' },
    { type: 'assistant', turnId: 1, content: 'hi', toolCalls: [] },
    { type: 'user', turnId: 2, content: 'do stuff' },
    {
      type: 'assistant',
      turnId: 2,
      content: 'ok',
      toolCalls: [{ id: 'tc1', name: 'bash', arguments: '{}' }],
    },
    {
      type: 'tool_result',
      turnId: 2,
      toolName: 'bash',
      toolCallId: 'tc1',
      output: 'result',
    },
    { type: 'user', turnId: 3, content: 'done' },
    { type: 'assistant', turnId: 3, content: 'great', toolCalls: [] },
  ];

  writeFileSync(transcriptPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

  const idx: SessionIndex = {
    sessionId,
    projectPath: slug,
    cwd: '/tmp/test',
    model: 'test-model',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: 7,
    title: 'fixture',
    currentTurnId: 3,
    usage: undefined,
    mode: 'build',
    permissionMode: 'default',
  };
  writeFileSync(indexPath, JSON.stringify(idx, null, 2), 'utf8');

  return { dir, transcriptPath, indexPath };
}

function appendEvent(jsonlPath: string, event: object): void {
  appendFileSync(jsonlPath, JSON.stringify(event) + '\n', 'utf8');
}

describe('rollback', () => {
  it('rollback hides events after the target turn', () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const fx = makeFixture(sessionId, slug);
    try {
      appendEvent(fx.transcriptPath, {
        type: 'rollback',
        throughTurnId: 1,
        reason: 'user rollback',
      });

      const { visible, compactedTurnIds } = filterForContext(readHistory(fx.transcriptPath));
      const messages = buildContextMessages(visible, compactedTurnIds);
      const userContents = messages.filter((m) => m.role === 'user').map((m) => m.content);
      expect(userContents).toEqual([]);
    } finally {
      rmSync(join(base.dir, slug), { recursive: true, force: true });
    }
  });

  it('partial rollback keeps earlier turns visible', () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const fx = makeFixture(sessionId, slug);
    try {
      appendEvent(fx.transcriptPath, {
        type: 'rollback',
        throughTurnId: 2,
        reason: 'user rollback',
      });

      const { visible, compactedTurnIds } = filterForContext(readHistory(fx.transcriptPath));
      const messages = buildContextMessages(visible, compactedTurnIds);
      const userContents = messages.filter((m) => m.role === 'user').map((m) => m.content);
      expect(userContents).toEqual(['hello']);
    } finally {
      rmSync(join(base.dir, slug), { recursive: true, force: true });
    }
  });
});
