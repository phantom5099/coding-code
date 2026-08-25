import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Effect } from 'effect';
import { SessionService } from '../../src/session/store.js';
import { computePaths } from '../../src/core/path.js';

import type { SessionIndex } from '../../src/session/types.js';
import { useTempProjectBase } from '../helpers/project-base.js';

const base = useTempProjectBase();

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(SessionService.Default) as any));
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
  const indexPath = paths.indexPath;

  const lines: any[] = [
    {
      type: 'session_meta',
      sessionId,
      cwd,
      createdAt: new Date().toISOString(),
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

  const idx: SessionIndex = {
    sessionId,
    cwd,
    model: 'test-model',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: lines.length,
    title: 'fixture',
    currentTurnId: turns.length,
    usage: turns[turns.length - 1]?.usage,
    activeProfile: 'build',
    permissionMode: 'default',
  };
  writeFileSync(indexPath, JSON.stringify(idx, null, 2), 'utf8');

  return { cwd, transcriptPath, indexPath };
}

function buildState(
  sessionId: string,
  cwd: string,
  initialUsage: { prompt: number; completion: number; total: number } | undefined,
  currentTurnId: number
) {
  return {
    sessionId,
    cwd,
    messageCount: 0,
    currentTurnId,
    sessionMeta: {
      type: 'session_meta' as const,
      sessionId,
      cwd,
      createdAt: new Date().toISOString(),
      activeProfile: 'build' as const,
      permissionMode: 'default' as const,
    },
    model: 'test-model',
    activeProfile: 'build' as const,
    permissionMode: 'default' as const,
    title: 'fixture',
    usage: initialUsage,
    memorySnapshot: '',
  };
}

describe('SessionService.appendSummary - state.usage reset (used by tryCompaction)', () => {
  it('clears state.usage and persists the cleared value to the session index', async () => {
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
      const idx = JSON.parse(readFileSync(fx.indexPath, 'utf8')) as SessionIndex;
      expect(idx.usage).toBeUndefined();
    } finally {
      rmSync(join(base.dir, slug), { recursive: true, force: true });
    }
  });

  it('preserves state.usage when called with state that has no prior usage', async () => {
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
      const idx = JSON.parse(readFileSync(fx.indexPath, 'utf8')) as SessionIndex;
      expect(idx.usage).toBeUndefined();
    } finally {
      rmSync(join(base.dir, slug), { recursive: true, force: true });
    }
  });
});
