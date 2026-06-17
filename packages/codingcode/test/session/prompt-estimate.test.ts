import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { Effect } from 'effect';
import { SessionService } from '../../src/session/store.js';
import { findSessionIndex } from '../../src/session/file-ops.js';
import { findLastVisibleAssistantUsage, buildMessages } from '../../src/session/messages.js';
import { estimateTokensForContent, estimateTokens } from '../../src/core/util.js';
import { encodeProjectPath } from '../../src/core/path.js';
import type { SessionIndex } from '../../src/session/types.js';

const PROJECT_BASE = join(homedir(), '.codingcode', 'project');

function makeFixture(
  sessionId: string,
  slug: string,
  usage?: { prompt: number; completion: number; total: number }
) {
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
    {
      type: 'user',
      turnId: 1,
      content: 'hello world',
    },
    {
      type: 'assistant',
      turnId: 1,
      content: 'hi there',
      toolCalls: [],
      usage,
    },
    {
      type: 'user',
      turnId: 2,
      content: 'do stuff',
    },
    {
      type: 'assistant',
      turnId: 2,
      content: 'ok done',
      toolCalls: [],
      usage: usage
        ? {
            prompt: usage.prompt + 100,
            completion: usage.completion + 50,
            total: usage.total + 150,
          }
        : undefined,
    },
  ];

  writeFileSync(transcriptPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

  const idx: SessionIndex = {
    sessionId,
    projectPath: slug,
    cwd: '/tmp/test',
    model: 'test-model',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: 4,
    title: 'fixture',
    currentTurnId: 2,
    usage: usage ?? undefined,
    promptEstimate: usage ? usage.prompt : estimateTokens(buildMessages(transcriptPath)),
    permissionMode: 'default',
  };
  writeFileSync(indexPath, JSON.stringify(idx, null, 2), 'utf8');

  return { dir, transcriptPath, indexPath };
}

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(SessionService.Default) as any));
}

describe('promptEstimate', () => {
  it('findLastVisibleAssistantUsage reads usage from visible assistant event', () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const usage = { prompt: 1200, completion: 300, total: 1500 };
    const lastUsage = { prompt: 1300, completion: 350, total: 1650 };
    const fx = makeFixture(sessionId, slug, usage);
    try {
      const result = findLastVisibleAssistantUsage(fx.transcriptPath);
      expect(result).toEqual(lastUsage);
    } finally {
      rmSync(join(PROJECT_BASE, slug), { recursive: true, force: true });
    }
  });

  it('findLastVisibleAssistantUsage returns undefined when no assistant usage', () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const fx = makeFixture(sessionId, slug, undefined);
    try {
      const result = findLastVisibleAssistantUsage(fx.transcriptPath);
      expect(result).toBeUndefined();
    } finally {
      rmSync(join(PROJECT_BASE, slug), { recursive: true, force: true });
    }
  });

  it('findLastVisibleAssistantUsage skips rolled-back assistant events', () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const dir = join(PROJECT_BASE, slug, 'sessions');
    mkdirSync(dir, { recursive: true });
    const transcriptPath = join(dir, `${sessionId}.jsonl`);

    const usage1 = { prompt: 100, completion: 50, total: 150 };
    const usage2 = { prompt: 200, completion: 100, total: 300 };
    const lines: any[] = [
      {
        type: 'session_meta',
        sessionId,
        projectPath: slug,
        cwd: '/tmp/test',
        createdAt: new Date().toISOString(),
      },
      {
        type: 'assistant',
        turnId: 1,
        content: 'first',
        toolCalls: [],
        usage: usage1,
      },
      {
        type: 'rollback',
        throughTurnId: 1,
        reason: 'test',
      },
      {
        type: 'assistant',
        turnId: 2,
        content: 'second',
        toolCalls: [],
        usage: usage2,
      },
    ];
    writeFileSync(transcriptPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

    try {
      const result = findLastVisibleAssistantUsage(transcriptPath);
      expect(result).toEqual(usage2);
    } finally {
      rmSync(join(PROJECT_BASE, slug), { recursive: true, force: true });
    }
  });

  it('findSessionIndex reads promptEstimate from index.json', () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const _fx = makeFixture(sessionId, slug, { prompt: 500, completion: 200, total: 700 });
    try {
      const idx = findSessionIndex(sessionId);
      expect(idx).not.toBeNull();
      expect(idx!.promptEstimate).toBe(500);
    } finally {
      rmSync(join(PROJECT_BASE, slug), { recursive: true, force: true });
    }
  });

  it('forkSession restores usage and promptEstimate from last visible assistant', async () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const usage = { prompt: 800, completion: 400, total: 1200 };
    const fx = makeFixture(sessionId, slug, usage);
    try {
      const state = {
        sessionId,
        cwd: '/tmp/test',
        projectPath: slug,
        transcriptPath: fx.transcriptPath,
        indexPath: fx.indexPath,
        messageCount: 4,
        currentTurnId: 2,
        sessionMeta: null,
        model: 'test-model',
        title: 'fixture',
        usage,
        promptEstimate: usage.prompt,
        memorySnapshot: '',
      };
      const newSessionId = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.forkSession(state, 2);
        })
      );
      const newIndexPath = join(fx.dir, `${newSessionId}.index.json`);
      const idx = JSON.parse(readFileSync(newIndexPath, 'utf8')) as SessionIndex;
      expect(idx.usage).toEqual(usage);
      expect(idx.promptEstimate).toBe(usage.prompt);
    } finally {
      rmSync(join(PROJECT_BASE, slug), { recursive: true, force: true });
    }
  });

  it('forkSession falls back to estimateTokens when no assistant usage', async () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const fx = makeFixture(sessionId, slug, undefined);
    try {
      const state = {
        sessionId,
        cwd: '/tmp/test',
        projectPath: slug,
        transcriptPath: fx.transcriptPath,
        indexPath: fx.indexPath,
        messageCount: 4,
        currentTurnId: 2,
        sessionMeta: null,
        model: 'test-model',
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
      const newIndexPath = join(fx.dir, `${newSessionId}.index.json`);
      const idx = JSON.parse(readFileSync(newIndexPath, 'utf8')) as SessionIndex;
      expect(idx.promptEstimate).toBeGreaterThan(0);
    } finally {
      rmSync(join(PROJECT_BASE, slug), { recursive: true, force: true });
    }
  });
});

describe('token estimation', () => {
  it('estimateTokensForContent returns > 0 for non-empty strings', () => {
    expect(estimateTokensForContent('hello world')).toBeGreaterThan(0);
    expect(estimateTokensForContent('')).toBe(0);
  });
});

describe('SessionService create sets model', () => {
  it('create sets state.model and persists it to index', async () => {
    const slug = randomUUID();
    const dir = join(PROJECT_BASE, slug);
    mkdirSync(dir, { recursive: true });
    try {
      const state = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, 'my-test-model');
        })
      );
      expect(state.model).toBe('my-test-model');

      const idx = JSON.parse(readFileSync(state.indexPath, 'utf8'));
      expect(idx.model).toBe('my-test-model');
    } finally {
      await new Promise((r) => setTimeout(r, 50));
      rmSync(join(PROJECT_BASE, encodeProjectPath(dir)), { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('SessionService record methods update promptEstimate', () => {
  it('recordUser increments promptEstimate', async () => {
    const slug = randomUUID();
    const dir = join(PROJECT_BASE, slug);
    mkdirSync(dir, { recursive: true });
    try {
      const state = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, 'test-model');
        })
      );
      expect(state.promptEstimate).toBe(0);

      const before = state.promptEstimate;
      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          yield* svc.recordUser(state, 'hello world');
        })
      );
      expect(state.promptEstimate).toBeGreaterThan(before);
    } finally {
      await new Promise((r) => setTimeout(r, 50));
      rmSync(join(PROJECT_BASE, encodeProjectPath(dir)), { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('recordAssistant without usage increments promptEstimate', async () => {
    const slug = randomUUID();
    const dir = join(PROJECT_BASE, slug);
    mkdirSync(dir, { recursive: true });
    try {
      const state = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, 'test-model');
        })
      );

      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          yield* svc.recordUser(state, 'hello');
        })
      );
      const before = state.promptEstimate;

      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          yield* svc.recordAssistant(state, 'reply', []);
        })
      );
      expect(state.promptEstimate).toBeGreaterThan(before);
      expect(state.usage).toBeUndefined();
    } finally {
      await new Promise((r) => setTimeout(r, 50));
      rmSync(join(PROJECT_BASE, encodeProjectPath(dir)), { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('recordAssistant with usage sets promptEstimate to usage.prompt', async () => {
    const slug = randomUUID();
    const dir = join(PROJECT_BASE, slug);
    mkdirSync(dir, { recursive: true });
    try {
      const state = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, 'test-model');
        })
      );

      const usage = { prompt: 999, completion: 111, total: 1110 };
      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          yield* svc.recordAssistant(state, 'reply', [], usage);
        })
      );
      expect(state.promptEstimate).toBe(999);
      expect(state.usage).toEqual(usage);
    } finally {
      await new Promise((r) => setTimeout(r, 50));
      rmSync(join(PROJECT_BASE, encodeProjectPath(dir)), { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('recordToolResult increments promptEstimate', async () => {
    const slug = randomUUID();
    const dir = join(PROJECT_BASE, slug);
    mkdirSync(dir, { recursive: true });
    try {
      const state = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, 'test-model');
        })
      );

      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          yield* svc.recordAssistant(state, 'use tool', [
            { id: 'tc1', name: 'bash', arguments: {} },
          ]);
        })
      );
      const before = state.promptEstimate;

      const toolEvent = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.recordToolResult(state, 'bash', 'tc1', 'tool output here');
        })
      );
      expect(state.promptEstimate).toBeGreaterThan(before);
      expect(toolEvent.output).toBe('tool output here');
    } finally {
      await new Promise((r) => setTimeout(r, 50));
      rmSync(join(PROJECT_BASE, encodeProjectPath(dir)), { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rollbackToTurn resets usage and recalculates promptEstimate', async () => {
    const slug = randomUUID();
    const dir = join(PROJECT_BASE, slug);
    mkdirSync(dir, { recursive: true });
    try {
      const state = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, 'test-model');
        })
      );

      const userEv = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.recordUser(state, 'hello world');
        })
      );
      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          yield* svc.recordAssistant(state, 'reply', [], {
            prompt: 100,
            completion: 50,
            total: 150,
          });
        })
      );
      expect(state.usage).toBeDefined();

      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          yield* svc.rollbackToTurn(state, userEv.turnId, 'test');
        })
      );
      expect(state.usage).toBeUndefined();
      expect(state.promptEstimate).toBeGreaterThanOrEqual(0);
    } finally {
      await new Promise((r) => setTimeout(r, 50));
      rmSync(join(PROJECT_BASE, encodeProjectPath(dir)), { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rollbackToTurn recalculates promptEstimate from visible messages, not old usage', async () => {
    const slug = randomUUID();
    const dir = join(PROJECT_BASE, slug);
    mkdirSync(dir, { recursive: true });
    try {
      const state = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, 'test-model');
        })
      );

      // Turn 1
      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          yield* svc.recordUser(state, 'hello world');
          yield* svc.recordAssistant(state, 'reply one', [], {
            prompt: 1000,
            completion: 100,
            total: 1100,
          });
        })
      );

      // Turn 2
      state.currentTurnId = 2;
      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          yield* svc.recordUser(state, 'do more stuff');
          yield* svc.recordAssistant(state, 'reply two', [], {
            prompt: 5000,
            completion: 200,
            total: 5200,
          });
        })
      );

      expect(state.promptEstimate).toBe(5000);
      expect(state.usage).toBeDefined();

      // Rollback to turn 1 — should hide turn 2 messages
      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          yield* svc.rollbackToTurn(state, 1, 'test rollback');
        })
      );

      // promptEstimate should restore from last visible assistant usage.prompt, not 5000
      expect(state.promptEstimate).toBeLessThan(5000);
      expect(state.promptEstimate).toBe(1000); // turn 1 assistant usage.prompt
      // usage should be restored from last visible assistant
      expect(state.usage).toEqual({ prompt: 1000, completion: 100, total: 1100 });
    } finally {
      await new Promise((r) => setTimeout(r, 50));
      rmSync(join(PROJECT_BASE, encodeProjectPath(dir)), { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
