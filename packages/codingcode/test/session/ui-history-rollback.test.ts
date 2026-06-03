import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, appendFileSync, rmSync } from 'fs';
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
    ...(extraEvents ?? []),
  ];

  writeFileSync(transcriptPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

  const idx: SessionIndex = {
    sessionId,
    projectPath: slug,
    cwd: '/tmp/test',
    model: 'test',
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
          model: 't',
          createdAt: new Date().toISOString(),
        },
        {
          type: 'user' as const,
          turnId: 1,
          uuid: 'u1',
          content: 'hello',
          timestamp: new Date().toISOString(),
        },
        {
          type: 'assistant' as const,
          turnId: 1,
          uuid: 'a1',
          content: 'hi',
          toolCalls: [],
          model: 't',
          timestamp: new Date().toISOString(),
        },
        {
          type: 'user' as const,
          turnId: 2,
          uuid: 'u2',
          content: 'bye',
          timestamp: new Date().toISOString(),
        },
        {
          type: 'assistant' as const,
          turnId: 2,
          uuid: 'a2',
          content: 'bye',
          toolCalls: [],
          model: 't',
          timestamp: new Date().toISOString(),
        },
        {
          type: 'hide' as const,
          uuid: 'h1',
          kind: 'rollback' as const,
          throughTurnId: 1,
          reason: 'test',
          timestamp: new Date().toISOString(),
        },
      ];
      const hidden = applyVisibilityEvents(events);
      expect(hidden.has('u2')).toBe(true);
      expect(hidden.has('a2')).toBe(true);
      expect(hidden.has('u1')).toBe(true);
      expect(hidden.has('a1')).toBe(true);
    } finally {
      rmSync(join(PROJECT_BASE, slug), { recursive: true, force: true });
    }
  });

  it('unhide restores rollback-hidden events', () => {
    const events = [
      {
        type: 'session_meta' as const,
        sessionId: 's',
        projectPath: 'p',
        cwd: '/tmp',
        model: 't',
        createdAt: new Date().toISOString(),
      },
      {
        type: 'user' as const,
        turnId: 1,
        uuid: 'u1',
        content: 'hello',
        timestamp: new Date().toISOString(),
      },
      {
        type: 'assistant' as const,
        turnId: 1,
        uuid: 'a1',
        content: 'hi',
        toolCalls: [],
        model: 't',
        timestamp: new Date().toISOString(),
      },
      {
        type: 'user' as const,
        turnId: 2,
        uuid: 'u2',
        content: 'bye',
        timestamp: new Date().toISOString(),
      },
      {
        type: 'assistant' as const,
        turnId: 2,
        uuid: 'a2',
        content: 'bye',
        toolCalls: [],
        model: 't',
        timestamp: new Date().toISOString(),
      },
      {
        type: 'hide' as const,
        uuid: 'h1',
        kind: 'rollback' as const,
        throughTurnId: 1,
        reason: 'test',
        timestamp: new Date().toISOString(),
      },
      {
        type: 'unhide' as const,
        uuid: 'uh1',
        targetHideUuid: 'h1',
        timestamp: new Date().toISOString(),
      },
    ];
    const hidden = applyVisibilityEvents(events);
    expect(hidden.has('u2')).toBe(false);
    expect(hidden.has('a2')).toBe(false);
  });

  it('message hide only hides the target', () => {
    const events = [
      {
        type: 'session_meta' as const,
        sessionId: 's',
        projectPath: 'p',
        cwd: '/tmp',
        model: 't',
        createdAt: new Date().toISOString(),
      },
      {
        type: 'user' as const,
        turnId: 1,
        uuid: 'u1',
        content: 'hello',
        timestamp: new Date().toISOString(),
      },
      {
        type: 'assistant' as const,
        turnId: 1,
        uuid: 'a1',
        content: 'hi',
        toolCalls: [],
        model: 't',
        timestamp: new Date().toISOString(),
      },
      {
        type: 'hide' as const,
        uuid: 'h1',
        kind: 'message' as const,
        targetUuid: 'u1',
        reason: 'test',
        timestamp: new Date().toISOString(),
      },
    ];
    const hidden = applyVisibilityEvents(events);
    expect(hidden.has('u1')).toBe(true);
    expect(hidden.has('a1')).toBe(false);
  });
});

describe('buildMessages with visibility filtering', () => {
  it('visible turns match after rollback', () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const fx = makeFixture(sessionId, slug, [
      {
        type: 'hide',
        uuid: randomUUID(),
        kind: 'rollback',
        throughTurnId: 1,
        reason: 'test',
        timestamp: new Date().toISOString(),
      },
    ]);
    try {
      const messages = buildMessages(fx.transcriptPath);
      const userContents = messages.filter((m) => m.role === 'user').map((m) => m.content);
      expect(userContents).toEqual([]);
    } finally {
      rmSync(join(PROJECT_BASE, slug), { recursive: true, force: true });
    }
  });

  it('messages after rollback and unhide match original', () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    try {
      const beforeEvents = [
        {
          type: 'session_meta',
          sessionId,
          projectPath: slug,
          cwd: '/tmp',
          model: 't',
          createdAt: new Date().toISOString(),
        },
        {
          type: 'user',
          turnId: 1,
          uuid: 'u1',
          content: 'hello',
          timestamp: new Date().toISOString(),
        },
        {
          type: 'assistant',
          turnId: 1,
          uuid: 'a1',
          content: 'hi',
          toolCalls: [],
          model: 't',
          timestamp: new Date().toISOString(),
        },
      ];
      const dir = join(PROJECT_BASE, slug, 'sessions');
      mkdirSync(dir, { recursive: true });
      const tp = join(dir, `${sessionId}.jsonl`);
      writeFileSync(tp, beforeEvents.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

      const before = buildMessages(tp);
      const hideUuid = randomUUID();
      appendFileSync(
        tp,
        JSON.stringify({
          type: 'hide',
          uuid: hideUuid,
          kind: 'rollback' as const,
          throughTurnId: 0,
          reason: 'test',
          timestamp: new Date().toISOString(),
        }) + '\n',
        'utf8'
      );
      appendFileSync(
        tp,
        JSON.stringify({
          type: 'unhide',
          uuid: randomUUID(),
          targetHideUuid: hideUuid,
          timestamp: new Date().toISOString(),
        }) + '\n',
        'utf8'
      );

      const after = buildMessages(tp);
      expect(after).toEqual(before);
    } finally {
      rmSync(join(PROJECT_BASE, slug), { recursive: true, force: true });
    }
  });
});

describe('undoLastHide only undoes message hides', () => {
  it('message hide can be undone', () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    try {
      const events = [
        {
          type: 'session_meta',
          sessionId,
          projectPath: slug,
          cwd: '/tmp',
          model: 't',
          createdAt: new Date().toISOString(),
        },
        {
          type: 'user',
          turnId: 1,
          uuid: 'u1',
          content: 'hello',
          timestamp: new Date().toISOString(),
        },
        {
          type: 'assistant',
          turnId: 1,
          uuid: 'a1',
          content: 'hi',
          toolCalls: [],
          model: 't',
          timestamp: new Date().toISOString(),
        },
        {
          type: 'hide',
          uuid: 'h-msg',
          kind: 'message' as const,
          targetUuid: 'u1',
          reason: 'test',
          timestamp: new Date().toISOString(),
        },
      ];
      const dir = join(PROJECT_BASE, slug, 'sessions');
      mkdirSync(dir, { recursive: true });
      const tp = join(dir, `${sessionId}.jsonl`);
      writeFileSync(tp, events.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

      // Before undo: u1 should be hidden
      const beforeMessages = buildMessages(tp);
      const userMessageCount = beforeMessages.filter((m) => m.role === 'user').length;
      expect(userMessageCount).toBe(0); // u1 hidden

      // Simulate undoLastHide (which now only undoes kind='message')
      appendFileSync(
        tp,
        JSON.stringify({
          type: 'unhide',
          uuid: randomUUID(),
          targetHideUuid: 'h-msg',
          timestamp: new Date().toISOString(),
        }) + '\n',
        'utf8'
      );

      const afterMessages = buildMessages(tp);
      const restoredCount = afterMessages.filter((m) => m.role === 'user').length;
      expect(restoredCount).toBe(1); // u1 restored
    } finally {
      rmSync(join(PROJECT_BASE, slug), { recursive: true, force: true });
    }
  });

  it('rollback hide is NOT undone by undoLastHide simulation', () => {
    // undoLastHide now only looks at kind='message' hides.
    // We add a message hide (hiding 'hello') AND a rollback hide (hiding turn 2).
    // Simulating undoLastHide: since it only undoes message hides, undoLastHide
    // will unhide 'hello' but 'bye' stays hidden by rollback.
    const sessionId = randomUUID();
    const slug = randomUUID();
    try {
      const events = [
        {
          type: 'session_meta',
          sessionId,
          projectPath: slug,
          cwd: '/tmp',
          model: 't',
          createdAt: new Date().toISOString(),
        },
        {
          type: 'user',
          turnId: 1,
          uuid: 'u1',
          content: 'hello',
          timestamp: new Date().toISOString(),
        },
        {
          type: 'assistant',
          turnId: 1,
          uuid: 'a1',
          content: 'hi',
          toolCalls: [],
          model: 't',
          timestamp: new Date().toISOString(),
        },
        {
          type: 'user',
          turnId: 2,
          uuid: 'u2',
          content: 'bye',
          timestamp: new Date().toISOString(),
        },
        {
          type: 'assistant',
          turnId: 2,
          uuid: 'a2',
          content: 'bye',
          toolCalls: [],
          model: 't',
          timestamp: new Date().toISOString(),
        },
      ];
      const dir = join(PROJECT_BASE, slug, 'sessions');
      mkdirSync(dir, { recursive: true });
      const tp = join(dir, `${sessionId}.jsonl`);
      writeFileSync(tp, events.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

      // Add message hide (hides u1, 'hello')
      appendFileSync(
        tp,
        JSON.stringify({
          type: 'hide',
          uuid: 'h-msg',
          kind: 'message',
          targetUuid: 'u1',
          reason: 'test',
          timestamp: new Date().toISOString(),
        }) + '\n',
        'utf8'
      );

      // Add rollback hide to turn 1 (hides turnId > 1 i.e. turn 2, 'bye')
      appendFileSync(
        tp,
        JSON.stringify({
          type: 'hide',
          uuid: 'h-rollback',
          kind: 'rollback',
          throughTurnId: 1,
          reason: 'test',
          timestamp: new Date().toISOString(),
        }) + '\n',
        'utf8'
      );

      // Verify both are hidden before undo
      const beforeMessages = buildMessages(tp);
      const beforeContents = beforeMessages.filter((m) => m.role === 'user').map((m) => m.content);
      expect(beforeContents).toEqual([]); // both hidden

      // Simulate undoLastHide: unhides the last kind='message' hide (h-msg)
      appendFileSync(
        tp,
        JSON.stringify({
          type: 'unhide',
          uuid: randomUUID(),
          targetHideUuid: 'h-msg',
          timestamp: new Date().toISOString(),
        }) + '\n',
        'utf8'
      );

      const messages = buildMessages(tp);
      const userContents = messages.filter((m) => m.role === 'user').map((m) => m.content);
      // 'hello' restored (message hide undone), 'bye' still hidden (rollback hide remains)
      expect(userContents).toContain('hello');
      expect(userContents).not.toContain('bye');
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
          model: 't',
          createdAt: new Date().toISOString(),
        },
        {
          type: 'user',
          turnId: 1,
          uuid: 'u1',
          content: 'hello',
          timestamp: new Date().toISOString(),
        },
        {
          type: 'assistant',
          turnId: 1,
          uuid: 'a1',
          content: 'hi',
          toolCalls: [],
          model: 't',
          timestamp: new Date().toISOString(),
        },
        {
          type: 'user',
          turnId: 2,
          uuid: 'u2',
          content: 'bye',
          timestamp: new Date().toISOString(),
        },
        {
          type: 'assistant',
          turnId: 2,
          uuid: 'a2',
          content: 'bye',
          toolCalls: [],
          model: 't',
          timestamp: new Date().toISOString(),
        },
        {
          type: 'hide',
          uuid: 'h1',
          kind: 'rollback' as const,
          throughTurnId: 1,
          reason: 'test',
          timestamp: new Date().toISOString(),
        },
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
      // No turns should be visible (turn 1 rolled back)
      expect(turns.length).toBe(0);
    } finally {
      rmSync(join(PROJECT_BASE, slug), { recursive: true, force: true });
    }
  });

  it('returns all turns when no rollback', () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const fx = makeFixture(sessionId, slug);
    try {
      const turns = readUIHistory(sessionId);
      expect(turns.length).toBe(3);
    } finally {
      rmSync(join(PROJECT_BASE, slug), { recursive: true, force: true });
    }
  });
});
