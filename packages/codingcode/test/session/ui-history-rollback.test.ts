import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { buildMessages, applyVisibilityEvents, readUIHistory } from '../../src/session/messages.js';
import type { SessionIndex } from '../../src/session/types.js';

const PROJECT_BASE = join(homedir(), '.codingcode', 'project');

function makeFixture(sessionId: string, slug: string, extraEvents?: object[]) {
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
    ...(extraEvents ?? []),
  ];

  writeFileSync(transcriptPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

  const idx: SessionIndex = {
    sessionId,
    projectPath: slug,
    cwd: '/tmp/test',
    model: 'test-model',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: lines.length,
    title: 'fixture',
    currentTurnId: 3,
    usage: undefined,
    promptEstimate: 0,
    permissionMode: 'default',
  };
  writeFileSync(indexPath, JSON.stringify(idx, null, 2), 'utf8');

  return { dir, transcriptPath, indexPath };
}

describe('applyVisibilityEvents', () => {
  it('marks rollback-hidden events', () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    try {
      const events = [
        {
          type: 'session_meta' as const,
          sessionId,
          projectPath: slug,
          cwd: '/tmp',
          createdAt: new Date().toISOString(),
        },
        { type: 'user' as const, turnId: 1, content: 'hello' },
        { type: 'assistant' as const, turnId: 1, content: 'hi', toolCalls: [] },
        { type: 'user' as const, turnId: 2, content: 'bye' },
        { type: 'assistant' as const, turnId: 2, content: 'bye', toolCalls: [] },
        { type: 'rollback' as const, throughTurnId: 1, reason: 'test' },
      ];
      const { hiddenTurnIds } = applyVisibilityEvents(events);
      expect(hiddenTurnIds.has(2)).toBe(true);
      expect(hiddenTurnIds.has(1)).toBe(true);
    } finally {
      rmSync(join(PROJECT_BASE, slug), { recursive: true, force: true });
    }
  });
});

describe('buildMessages with visibility filtering', () => {
  it('visible turns match after rollback', () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const fx = makeFixture(sessionId, slug, [
      { type: 'rollback', throughTurnId: 1, reason: 'test' },
    ]);
    try {
      const messages = buildMessages(fx.transcriptPath);
      const userContents = messages.filter((m) => m.role === 'user').map((m) => m.content);
      expect(userContents).toEqual([]);
    } finally {
      rmSync(join(PROJECT_BASE, slug), { recursive: true, force: true });
    }
  });
});

describe('readUIHistory with visibility filtering', () => {
  it('hides turns after rollback', () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    try {
      const events = [
        {
          type: 'session_meta',
          sessionId,
          projectPath: slug,
          cwd: '/tmp',
          createdAt: new Date().toISOString(),
        },
        { type: 'user', turnId: 1, content: 'hello' },
        { type: 'assistant', turnId: 1, content: 'hi', toolCalls: [] },
        { type: 'user', turnId: 2, content: 'bye' },
        { type: 'assistant', turnId: 2, content: 'bye', toolCalls: [] },
        { type: 'rollback', throughTurnId: 1, reason: 'test' },
      ];
      const dir = join(PROJECT_BASE, slug, 'sessions');
      mkdirSync(dir, { recursive: true });
      const tp = join(dir, `${sessionId}.jsonl`);
      writeFileSync(tp, events.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
      writeFileSync(
        join(dir, `${sessionId}.index.json`),
        JSON.stringify({
          sessionId,
          projectPath: slug,
          cwd: '/tmp',
          model: 't',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messageCount: 7,
          title: 'test',
          currentTurnId: 2,
          usage: undefined,
          promptEstimate: 0,
          permissionMode: 'default',
        })
      );

      const turns = readUIHistory(sessionId);
      expect(turns.length).toBe(0);
    } finally {
      rmSync(join(PROJECT_BASE, slug), { recursive: true, force: true });
    }
  });

  it('returns all turns when no rollback', () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const _fx = makeFixture(sessionId, slug);
    try {
      const turns = readUIHistory(sessionId);
      expect(turns.length).toBe(3);
    } finally {
      rmSync(join(PROJECT_BASE, slug), { recursive: true, force: true });
    }
  });
});
