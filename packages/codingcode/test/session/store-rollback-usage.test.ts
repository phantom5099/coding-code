import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Effect } from 'effect';
import { SessionService } from '../../src/session/port.js';
import { SessionLayer } from '../../src/session/session.js';
import { computePaths } from '../../src/session/paths.js';

import type { SessionStoreState } from '../../src/contracts/session.js';
import { useTempProjectBase } from '../helpers/project-base.js';

const base = useTempProjectBase();

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(SessionLayer) as any));
}

function makeFixture(
  sessionId: string,
  slug: string,
  turns: Array<{
    user: string;
    assistant: string;
    usage: { prompt: number; completion: number; total: number } | undefined;
  }>
) {
  const cwd = `/${slug}`;
  const paths = computePaths(cwd, sessionId);
  mkdirSync(join(base.dir, slug, 'sessions'), { recursive: true });
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
  ];
  turns.forEach((t, i) => {
    const turnId = i + 1;
    lines.push({ type: 'user', turnId, content: t.user });
    lines.push({
      type: 'assistant',
      turnId,
      content: t.assistant,
      toolCalls: [],
      usage: t.usage,
    });
  });

  writeFileSync(transcriptPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

  return { cwd, transcriptPath };
}

function buildState(
  sessionId: string,
  cwd: string,
  initialUsage: { prompt: number; completion: number; total: number } | undefined,
  currentTurnId: number
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
    currentTurnId,
    memorySnapshot: '',
    usage: initialUsage,
  };
}

describe('SessionService.rollbackToTurn - state.usage reset', () => {
  it('clears state.usage when rollback leaves no assistant events', async () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const usage1 = { prompt: 100, completion: 50, total: 150 };
    const fx = makeFixture(sessionId, slug, [{ user: 'q1', assistant: 'a1', usage: usage1 }]);
    try {
      const state = buildState(sessionId, fx.cwd, usage1, 1);
      const reloaded = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          yield* svc.rollbackToTurn(state, 1, 'user rollback');
          return yield* svc.load(fx.cwd, sessionId);
        })
      );
      expect(state.usage).toBeUndefined();
      expect(reloaded.usage).toBeUndefined();
    } finally {
      rmSync(join(base.dir, slug), { recursive: true, force: true });
    }
  });

  it('restores state.usage to the last visible assistant event after partial rollback', async () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const usage1 = { prompt: 100, completion: 50, total: 150 };
    const usage2 = { prompt: 800, completion: 400, total: 1200 };
    const usage3 = { prompt: 1500, completion: 600, total: 2100 };
    const fx = makeFixture(sessionId, slug, [
      { user: 'q1', assistant: 'a1', usage: usage1 },
      { user: 'q2', assistant: 'a2', usage: usage2 },
      { user: 'q3', assistant: 'a3', usage: usage3 },
    ]);
    try {
      const state = buildState(sessionId, fx.cwd, usage3, 3);
      const reloaded = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          yield* svc.rollbackToTurn(state, 2, 'user rollback');
          return yield* svc.load(fx.cwd, sessionId);
        })
      );
      expect(state.usage).toEqual(usage1);
      expect(reloaded.usage).toEqual(usage1);
    } finally {
      rmSync(join(base.dir, slug), { recursive: true, force: true });
    }
  });

  it('picks the last visible assistant usage, skipping assistant events without usage', async () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const usage1 = { prompt: 100, completion: 50, total: 150 };
    const usage2 = { prompt: 800, completion: 400, total: 1200 };
    const fx = makeFixture(sessionId, slug, [
      { user: 'q1', assistant: 'a1', usage: usage1 },
      { user: 'q2', assistant: 'a2', usage: undefined },
      { user: 'q3', assistant: 'a3', usage: usage2 },
    ]);
    try {
      const state = buildState(sessionId, fx.cwd, usage2, 3);
      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.rollbackToTurn(state, 3, 'user rollback');
        })
      );
      expect(state.usage).toEqual(usage1);
    } finally {
      rmSync(join(base.dir, slug), { recursive: true, force: true });
    }
  });
});
