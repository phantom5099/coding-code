import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { Effect } from 'effect';
import { SessionService } from '../../src/session/store.js';
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
      createdAt: new Date().toISOString(),
    },
    { type: 'user', turnId: 1, content: 'first' },
    {
      type: 'assistant',
      turnId: 1,
      content: 'reply1',
      toolCalls: [],
    },
    { type: 'user', turnId: 2, content: 'second' },
    {
      type: 'assistant',
      turnId: 2,
      content: 'reply2',
      toolCalls: [{ id: 'tc1', name: 'bash', arguments: '{}' }],
    },
    {
      type: 'tool_result',
      turnId: 2,
      toolName: 'bash',
      toolCallId: 'tc1',
      output: 'cmd output',
    },
    { type: 'user', turnId: 3, content: 'third' },
    {
      type: 'assistant',
      turnId: 3,
      content: 'reply3',
      toolCalls: [],
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

function readEvents(jsonlPath: string): SessionEvent[] {
  const content = readFileSync(jsonlPath, 'utf8');
  return content
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as SessionEvent);
}

function collectToolCallIds(events: SessionEvent[]): Set<string> {
  const ids = new Set<string>();
  for (const e of events) {
    if (e.type === 'assistant') {
      for (const tc of e.toolCalls) {
        ids.add(tc.id);
      }
    }
    if (e.type === 'tool_result') {
      ids.add(e.toolCallId);
    }
  }
  return ids;
}

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(SessionService.Default) as any));
}

describe('forkSession', () => {
  it('fork copies events from root to atTurnId', async () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const fx = makeFixture(sessionId, slug);
    try {
      const state = {
        sessionId,
        cwd: '/tmp/test',
        projectPath: slug,
        transcriptPath: fx.transcriptPath,
        indexPath: fx.indexPath,
        messageCount: 7,
        currentTurnId: 3,
        sessionMeta: null,
        model: 'test',
        title: 'fixture',
        usage: undefined,
        promptEstimate: 0,
        memorySnapshot: '',
      };

      // Fork at turn 2 (user message "second")
      const newSessionId = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.forkSession(state, 2);
        })
      );

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
    } finally {
      rmSync(join(PROJECT_BASE, slug), { recursive: true, force: true });
    }
  });

  it('forked session has regenerated toolCallIds', async () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const fx = makeFixture(sessionId, slug);
    try {
      const state = {
        sessionId,
        cwd: '/tmp/test',
        projectPath: slug,
        transcriptPath: fx.transcriptPath,
        indexPath: fx.indexPath,
        messageCount: 7,
        currentTurnId: 3,
        sessionMeta: null,
        model: 'test',
        title: 'fixture',
        usage: undefined,
        promptEstimate: 0,
        memorySnapshot: '',
      };

      const newSessionId = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.forkSession(state, 3);
        })
      );

      const newJsonlPath = join(fx.dir, `${newSessionId}.jsonl`);
      const newEvents = readEvents(newJsonlPath);

      const originalEvents = readEvents(fx.transcriptPath);
      const originalToolCallIds = collectToolCallIds(originalEvents);
      const newToolCallIds = collectToolCallIds(newEvents);

      // No toolCallId overlap
      for (const id of newToolCallIds) {
        expect(originalToolCallIds.has(id)).toBe(false);
      }
      // Tool result still maps to the regenerated assistant toolCall id
      const forkedAssistant = newEvents.find((e) => e.type === 'assistant' && e.turnId === 2) as
        | { toolCalls: Array<{ id: string }> }
        | undefined;
      const forkedToolResult = newEvents.find((e) => e.type === 'tool_result') as
        | { toolCallId: string }
        | undefined;
      expect(forkedAssistant).toBeDefined();
      expect(forkedToolResult).toBeDefined();
      expect(forkedToolResult!.toolCallId).toBe(forkedAssistant!.toolCalls[0]!.id);
    } finally {
      rmSync(join(PROJECT_BASE, slug), { recursive: true, force: true });
    }
  });

  it('rollback in forked session does not affect source', async () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const fx = makeFixture(sessionId, slug);
    try {
      const state = {
        sessionId,
        cwd: '/tmp/test',
        projectPath: slug,
        transcriptPath: fx.transcriptPath,
        indexPath: fx.indexPath,
        messageCount: 7,
        currentTurnId: 3,
        sessionMeta: null,
        model: 'test',
        title: 'fixture',
        usage: undefined,
        promptEstimate: 0,
        memorySnapshot: '',
      };

      const newSessionId = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.forkSession(state, 2);
        })
      );

      const newJsonlPath = join(fx.dir, `${newSessionId}.jsonl`);

      // Append a rollback event in the forked session
      writeFileSync(
        newJsonlPath,
        readFileSync(newJsonlPath, 'utf8') +
          JSON.stringify({
            type: 'rollback',
            throughTurnId: 2,
            reason: 'rolled back in fork',
          }) +
          '\n',
        'utf8'
      );

      // Source should be unaffected
      const sourceMessages = buildMessages(fx.transcriptPath);
      const sourceUserContents = sourceMessages
        .filter((m) => m.role === 'user')
        .map((m) => m.content);
      expect(sourceUserContents).toEqual(['first', 'second', 'third']);

      // Fork should reflect the rollback
      const forkMessages = buildMessages(newJsonlPath);
      const forkUserContents = forkMessages.filter((m) => m.role === 'user').map((m) => m.content);
      expect(forkUserContents).toEqual(['first']);
    } finally {
      rmSync(join(PROJECT_BASE, slug), { recursive: true, force: true });
    }
  });

  it('fork creates index.json with correct metadata', async () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const fx = makeFixture(sessionId, slug);
    try {
      const state = {
        sessionId,
        cwd: '/tmp/test',
        projectPath: slug,
        transcriptPath: fx.transcriptPath,
        indexPath: fx.indexPath,
        messageCount: 7,
        currentTurnId: 3,
        sessionMeta: null,
        model: 'test',
        title: 'fixture',
        usage: undefined,
        promptEstimate: 0,
        memorySnapshot: '',
      };

      const newSessionId = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.forkSession(state, 1);
        })
      );

      const newIndexPath = join(fx.dir, `${newSessionId}.index.json`);
      expect(existsSync(newIndexPath)).toBe(true);

      const idx = JSON.parse(readFileSync(newIndexPath, 'utf8')) as SessionIndex;
      expect(idx.sessionId).toBe(newSessionId);
      expect(idx.title).toBe('fixture');
      expect(idx.permissionMode).toBe('default');
      expect(idx.model).toBe('test');
    } finally {
      rmSync(join(PROJECT_BASE, slug), { recursive: true, force: true });
    }
  });
});
