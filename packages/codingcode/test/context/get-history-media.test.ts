import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import { Effect, Layer } from 'effect';
import { ContextService } from '../../src/context/port.js';
import type { ContextShape } from '../../src/context/port.js';
import { SessionLayer } from '../../src/session/session.js';
import { LLMService } from '../../src/llm/port.js';
import type { SessionRef } from '../../src/session/types.js';
import { assetsDirOf } from '../../src/session/paths.js';
import { assetNameFor, writeAsset } from '../../src/session/assets.js';
import { useTempProjectBase } from '../helpers/project-base.js';
import { ContextLayer, transcriptPathFor } from '../../src/context/context.js';
import { EventSinkLayer } from '../../src/sink/sink.js';
import { TurnRegistryLayer } from '../../src/turn/registry.js';

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

const CWD = '/tmp/test';
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

function getCtxService(): Promise<ContextShape> {
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* ContextService;
    }).pipe(Effect.provide(ContextLayer), Effect.provide(TestLayer))
  );
}

/** 转录里引用一个媒体块；`onDisk` 决定资产是否真的落在 assets 下。 */
function writeTranscript(ref: SessionRef, asset: string, onDisk: boolean): string {
  const path = transcriptPathFor(ref);
  mkdirSync(dirname(path), { recursive: true });
  const lines = [
    {
      type: 'session_meta',
      sessionId: ref.sessionId,
      cwd: CWD,
      createdAt: new Date().toISOString(),
      model: 'test-model',
      title: 'media-fixture',
      activeProfile: 'build',
      permissionMode: 'askBeforeExec',
    },
    {
      type: 'user',
      turnId: 1,
      content: [
        { type: 'text', text: '看这张图' },
        { type: 'media', asset, mimeType: 'image/png', bytes: PNG.byteLength },
      ],
    },
  ];
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

  const assetDir = assetsDirOf(CWD);
  mkdirSync(assetDir, { recursive: true });
  if (onDisk) writeAsset(assetDir, asset, PNG);
  return path;
}

describe('getHistory 的媒体装配', () => {
  let ref: SessionRef;
  let transcriptPath: string;
  let assetDir: string;

  beforeEach(() => {
    ref = { cwd: CWD, sessionId: randomUUID(), currentTurnId: 1 };
    assetDir = assetsDirOf(CWD);
  });

  afterEach(() => {
    const dir = dirname(transcriptPath);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    if (existsSync(assetDir)) rmSync(assetDir, { recursive: true, force: true });
  });

  it('资产在位时解析成 data URL，交给驱动的载荷自带字节', async () => {
    const asset = assetNameFor(PNG, 'image/png');
    transcriptPath = writeTranscript(ref, asset, true);

    const ctx = await getCtxService();
    const messages = await Effect.runPromise(ctx.getHistory(ref, 'test-model'));

    const user = messages.find((m) => m.role === 'user')!;
    expect(user.content[0]).toEqual({ type: 'text', text: '看这张图' });
    expect(user.content[1]).toMatchObject({
      type: 'media',
      mimeType: 'image/png',
      dataUrl: `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`,
    });
    // 引用形态不该漏到出网载荷里
    expect('asset' in (user.content[1] as object)).toBe(false);
  });

  it('资产缺失时降级成文本标记，不在驱动层抛错', async () => {
    transcriptPath = writeTranscript(ref, 'deadbeefdeadbeef.png', false);

    const ctx = await getCtxService();
    const messages = await Effect.runPromise(ctx.getHistory(ref, 'test-model'));

    const user = messages.find((m) => m.role === 'user')!;
    expect(user.content[1]).toEqual({
      type: 'text',
      text: '[media missing: deadbeefdeadbeef.png]',
    });
  });
});
