import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Effect } from 'effect';
import { SessionService } from '../../src/session/port.js';
import { SessionLayer } from '../../src/session/session.js';

import { estimatePromptTokensFrom } from '../../src/context/context.js';
import { readHistory, readLastUsage, readSessionMeta } from '../../src/session/file-ops.js';
import { estimateTokensForContent } from '../../src/context/tokens.js';
import { encodeProjectPath } from '../../src/core/path.js';
import { computePaths } from '../../src/session/paths.js';
import type { SessionStoreState } from '../../src/session/types.js';
import { useTempProjectBase } from '../helpers/project-base.js';

const base = useTempProjectBase();

function makeFixture(
  sessionId: string,
  slug: string,
  usage?: { prompt: number; completion: number; total: number }
) {
  const cwd = `/${slug}`;
  const paths = computePaths(cwd, sessionId);
  const dir = join(base.dir, slug, 'sessions');
  mkdirSync(dir, { recursive: true });
  const transcriptPath = paths.transcriptPath;

  const lines: any[] = [
    {
      type: 'session_meta',
      sessionId,
      cwd,
      createdAt: new Date().toISOString(),
      model: 'test-model',
      title: 'fixture',
      activeProfile: 'build',
      permissionMode: 'askBeforeExec',
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

  return { cwd, dir, transcriptPath };
}

function makeState(
  sessionId: string,
  cwd: string,
  usage: { prompt: number; completion: number; total: number } | undefined
): SessionStoreState {
  return {
    type: 'session_meta',
    sessionId,
    cwd,
    createdAt: new Date().toISOString(),
    model: 'test-model',
    title: 'fixture',
    activeProfile: 'build',
    permissionMode: 'askBeforeExec',
    currentTurnId: 2,
    memorySnapshot: '',
    usage,
  };
}

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(SessionLayer) as any));
}

describe('promptEstimate', () => {
  it('forkSession keeps the last visible assistant usage on the forked transcript', async () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const usage = { prompt: 800, completion: 400, total: 1200 };
    const fx = makeFixture(sessionId, slug, usage);
    try {
      const state = makeState(sessionId, fx.cwd, usage);
      const newSessionId = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.forkSession(state, 2);
        })
      );
      const forkedPath = join(fx.dir, `${newSessionId}.jsonl`);
      expect(readLastUsage(forkedPath)).toEqual(usage);
    } finally {
      rmSync(join(base.dir, slug), { recursive: true, force: true });
    }
  });

  it('forkSession produces a readable session with a positive prompt estimate when no assistant usage', async () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const fx = makeFixture(sessionId, slug, undefined);
    try {
      const state = makeState(sessionId, fx.cwd, undefined);
      const newSessionId = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.forkSession(state, 2);
        })
      );
      const forkedPath = join(fx.dir, `${newSessionId}.jsonl`);
      expect(readSessionMeta(forkedPath)?.sessionId).toBe(newSessionId);
      expect(estimatePromptTokensFrom(readHistory(forkedPath))).toBeGreaterThan(0);
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
  it('create persists model to the session head', async () => {
    const slug = randomUUID();
    const dir = join(base.dir, slug);
    mkdirSync(dir, { recursive: true });
    try {
      const state = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.create(dir, {
            model: 'my-test-model',
            activeProfile: 'build',
            permissionMode: 'askBeforeExec',
          });
        })
      );

      const meta = readSessionMeta(
        computePaths(state.cwd, state.sessionId, state.parentSessionId).transcriptPath
      );
      expect(meta?.model).toBe('my-test-model');
    } finally {
      await new Promise((r) => setTimeout(r, 50));
      rmSync(join(base.dir, encodeProjectPath(dir)), { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
