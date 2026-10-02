import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Effect } from 'effect';
import { SessionService } from '../../src/session/port.js';
import { SessionLayer } from '../../src/session/session.js';
import { computePaths } from '../../src/core/path.js';

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
      permissionMode: 'ask',
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
    permissionMode: 'ask',
    currentTurnId,
    memorySnapshot: '',
    usage: initialUsage,
  };
}

describe('SessionService.appendSummary - state.usage reset (used by tryCompaction)', () => {
  it('clears state.usage', async () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const usage1 = { prompt: 100, completion: 50, total: 150 };
    const fx = makeFixture(sessionId, slug, [{ user: 'q1', assistant: 'a1', usage: usage1 }]);
    try {
      const state = buildState(sessionId, fx.cwd, usage1, 1);
      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.appendSummary(state, 'compacted summary', 1, 1);
        })
      );
      expect(state.usage).toBeUndefined();
    } finally {
      rmSync(join(base.dir, slug), { recursive: true, force: true });
    }
  });

  it('keeps state.usage undefined when called with state that has no prior usage', async () => {
    const sessionId = randomUUID();
    const slug = randomUUID();
    const fx = makeFixture(sessionId, slug, [{ user: 'q1', assistant: 'a1', usage: undefined }]);
    try {
      const state = buildState(sessionId, fx.cwd, undefined, 1);
      await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.appendSummary(state, 'compacted summary', 1, 1);
        })
      );
      expect(state.usage).toBeUndefined();
    } finally {
      rmSync(join(base.dir, slug), { recursive: true, force: true });
    }
  });
});
