import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Effect, Layer } from 'effect';
import { ContextService } from '../../src/context/port.js';
import type { ContextShape } from '../../src/context/port.js';
import { SessionService } from '../../src/session/port.js';
import { SessionLayer } from '../../src/session/session.js';
import { LLMFactoryService } from '../../src/llm/port.js';
import type { SessionEvent } from '../../src/contracts/session.js';
import { useTempProjectBase } from '../helpers/project-base.js';
import { ContextLayer } from '../../src/context/context.js';

const base = useTempProjectBase();

const TestLayer = Layer.merge(
  SessionLayer,
  Layer.succeed(LLMFactoryService, {
    listModels: () => Effect.succeed([]),
    findModel: () => Effect.succeed(null),
    getActiveEntry: () => Effect.fail(new Error('no active model')),
    switchModel: () => Effect.fail(new Error('no models')),
    createClient: () => Effect.fail(new Error('no client')),
    getLLMClient: () => Effect.fail(new Error('no client')),
  } as any)
);

async function getCtxService(): Promise<ContextShape> {
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* ContextService;
    }).pipe(Effect.provide(ContextLayer), Effect.provide(TestLayer))
  );
}

describe('assemblePayload integration', () => {
  const projectSlug = randomUUID();
  let sessionId: string;
  let sessionDir: string;
  let jsonlPath: string;
  let indexPath: string;

  beforeEach(() => {
    sessionId = randomUUID();
    sessionDir = join(base.dir, projectSlug, 'sessions');
    mkdirSync(sessionDir, { recursive: true });
    jsonlPath = join(sessionDir, `${sessionId}.jsonl`);
    indexPath = join(sessionDir, `${sessionId}.index.json`);

    const lines: any[] = [
      {
        type: 'session_meta',
        sessionId,
        cwd: '/tmp/test',

        createdAt: new Date().toISOString(),
        activeProfile: 'build',
        permissionMode: 'default',
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
    writeFileSync(jsonlPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

    const idx = {
      sessionId,
      cwd: '/tmp/test',
      model: 'test-model',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: lines.length,
      title: 'fixture',
      currentTurnId: 1,
      usage: undefined,
      permissionMode: 'default',
      activeProfile: 'build',
    };
    writeFileSync(indexPath, JSON.stringify(idx, null, 2), 'utf8');
  });

  afterEach(() => {
    const dir = join(base.dir, projectSlug);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('returns messages assembled from the transcript', async () => {
    const ctx = await getCtxService();
    const messages = await ctx.assemblePayload(jsonlPath, 128000, null);

    expect(messages.length).toBeGreaterThan(0);
  });

  it('returns an empty message list when the transcript is empty', async () => {
    const emptyJsonl = join(sessionDir, `${sessionId}-empty.jsonl`);
    writeFileSync(emptyJsonl, '', 'utf8');
    const ctx = await getCtxService();
    const messages = await ctx.assemblePayload(emptyJsonl, 128000, null);
    expect(messages).toEqual([]);
  });
});
