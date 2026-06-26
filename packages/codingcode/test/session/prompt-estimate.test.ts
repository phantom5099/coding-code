import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Effect } from 'effect';
import { SessionService } from '../../src/session/store.js';

import { estimatePromptTokens } from '../../src/context/service.js';
import { estimateTokensForContent } from '../../src/core/util.js';
import { encodeProjectPath } from '../../src/core/path.js';
import type { SessionIndex } from '../../src/session/types.js';
import { useTempProjectBase } from '../helpers/project-base.js';

const base = useTempProjectBase();

function makeFixture(
  sessionId: string,
  slug: string,
  usage?: { prompt: number; completion: number; total: number }
) {
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
    mode: 'build' as const,
    permissionMode: 'default' as const,
  };
  writeFileSync(indexPath, JSON.stringify(idx, null, 2), 'utf8');

  return { dir, transcriptPath, indexPath };
}

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(SessionService.Default) as any));
}

describe('promptEstimate', () => {
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
        mode: 'build' as const,
        permissionMode: 'default' as const,
        title: 'fixture',
        usage,
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
    } finally {
      rmSync(join(base.dir, slug), { recursive: true, force: true });
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
        mode: 'build' as const,
        permissionMode: 'default' as const,
        title: 'fixture',
        usage: undefined,
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
      expect(idx.sessionId).toBe(newSessionId);
      expect(estimatePromptTokens(join(fx.dir, `${newSessionId}.jsonl`))).toBeGreaterThan(0);
    } finally {
      rmSync(join(base.dir, slug), { recursive: true, force: true });
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
    const dir = join(base.dir, slug);
    mkdirSync(dir, { recursive: true });
    try {
      const state = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, {
            model: 'my-test-model',
            mode: 'build',
            permissionMode: 'default',
          });
        })
      );
      expect(state.model).toBe('my-test-model');

      const idx = JSON.parse(readFileSync(state.indexPath, 'utf8'));
      expect(idx.model).toBe('my-test-model');
    } finally {
      await new Promise((r) => setTimeout(r, 50));
      rmSync(join(base.dir, encodeProjectPath(dir)), { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
