import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import { Effect, Layer } from 'effect';
import { ContextService } from '../../src/context/port.js';
import type { ContextShape } from '../../src/context/port.js';
import { SessionLayer } from '../../src/session/session.js';
import { LLMService } from '../../src/llm/port.js';
import type { SessionRef } from '../../src/contracts/session.js';
import { useTempProjectBase } from '../helpers/project-base.js';
import { ContextLayer, transcriptPathFor } from '../../src/context/context.js';

useTempProjectBase();

const TestLayer = Layer.merge(
  SessionLayer,
  Layer.succeed(LLMService, {
    complete: () => Effect.fail(new Error('no llm')),
    completeStream: () => (async function* () {})(),
  } as any)
);

async function getCtxService(): Promise<ContextShape> {
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* ContextService;
    }).pipe(Effect.provide(ContextLayer), Effect.provide(TestLayer))
  );
}

const CWD = '/tmp/test';

describe('assemblePayload integration', () => {
  let ref: SessionRef;
  let transcriptPath: string;

  beforeEach(() => {
    ref = { cwd: CWD, sessionId: randomUUID(), currentTurnId: 1 };
    transcriptPath = transcriptPathFor(ref);
    mkdirSync(dirname(transcriptPath), { recursive: true });

    const lines: any[] = [
      {
        type: 'session_meta',
        sessionId: ref.sessionId,
        cwd: CWD,
        createdAt: new Date().toISOString(),
        model: 'test-model',
        title: 'fixture',
        activeProfile: 'build',
        permissionMode: 'ask',
      },
      { type: 'user', turnId: 1, content: 'q1' },
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
    const messages = await Effect.runPromise(ctx.assemblePayload(ref, 'test-model'));

    expect(messages.length).toBeGreaterThan(0);
  });

  it('returns an empty message list when the transcript is empty', async () => {
    const emptyRef: SessionRef = { cwd: CWD, sessionId: `${ref.sessionId}-empty`, currentTurnId: 1 };
    const emptyPath = transcriptPathFor(emptyRef);
    writeFileSync(emptyPath, '', 'utf8');
    const ctx = await getCtxService();
    const messages = await Effect.runPromise(ctx.assemblePayload(emptyRef, 'test-model'));
    expect(messages).toEqual([]);
  });
});
