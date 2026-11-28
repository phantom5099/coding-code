import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import { Effect, Layer } from 'effect';
import { ContextService } from '@codingcode/context';
import type { ContextShape } from '@codingcode/context';
import { SessionLayer, transcriptPathOf } from '@codingcode/session';
import { LLMService } from '@codingcode/model';
import type { SessionRef } from '@codingcode/session';
import { useTempProjectBase } from '../helpers/project-base.js';
import { ContextLayer } from '@codingcode/context';
import { EventSinkLayer } from '@codingcode/sink';
import { TurnRegistryLayer } from '@codingcode/turn';

useTempProjectBase();

const TurnWithDeps = TurnRegistryLayer.pipe(Layer.provide(EventSinkLayer));

const TestLayer = Layer.mergeAll(
  SessionLayer,
  Layer.succeed(LLMService, {
    complete: () => Effect.fail(new Error('no llm')),
    completeStream: () => (async function* () {})(),
  } as any),
  EventSinkLayer,
  TurnWithDeps
);

async function getCtxService(): Promise<ContextShape> {
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* ContextService;
    }).pipe(Effect.provide(ContextLayer), Effect.provide(TestLayer))
  );
}

const CWD = '/tmp/test';

describe('getHistory integration', () => {
  let ref: SessionRef;
  let transcriptPath: string;

  beforeEach(() => {
    ref = { cwd: CWD, sessionId: randomUUID(), currentTurnId: 1 };
    transcriptPath = transcriptPathOf(ref);
    mkdirSync(dirname(transcriptPath), { recursive: true });

    const lines: any[] = [
      {
        type: 'session_meta',
        sessionId: ref.sessionId,
        cwd: CWD,
        createdAt: new Date().toISOString(),
        model: 'test-model',
        title: 'fixture',
        permissionMode: 'askBeforeExec',
      },
      { type: 'user', turnId: 1, content: [{ type: 'text', text: 'q1' }] },
      {
        type: 'assistant',
        turnId: 1,
        content: 'r1',
        toolCalls: [
          { id: 'tc1', name: 'bash', arguments: {} },
          { id: 'tc2', name: 'bash', arguments: {} },
        ],
      },
      {
        type: 'tool_result',
        turnId: 1,
        toolName: 'bash',
        toolCallId: 'tc1',
        output: 'x'.repeat(200),
      },
      {
        type: 'tool_result',
        turnId: 1,
        toolName: 'bash',
        toolCallId: 'tc2',
        output: 'y'.repeat(200),
      },
    ];
    writeFileSync(transcriptPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  });

  afterEach(() => {
    const dir = dirname(transcriptPath);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('returns messages assembled from the transcript', async () => {
    const ctx = await getCtxService();
    const messages = await Effect.runPromise(ctx.getHistory({ session: ref, model: 'test-model' }));

    expect(messages.length).toBeGreaterThan(0);
  });

  it('returns an empty message list when the transcript is empty', async () => {
    const emptyRef: SessionRef = {
      cwd: CWD,
      sessionId: `${ref.sessionId}-empty`,
      currentTurnId: 1,
    };
    const emptyPath = transcriptPathOf(emptyRef);
    writeFileSync(emptyPath, '', 'utf8');
    const ctx = await getCtxService();
    const messages = await Effect.runPromise(
      ctx.getHistory({ session: emptyRef, model: 'test-model' })
    );
    expect(messages).toEqual([]);
  });
});
