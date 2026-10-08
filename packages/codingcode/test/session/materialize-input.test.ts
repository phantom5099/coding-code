import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readdirSync, rmSync, unlinkSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Effect, Either } from 'effect';
import { SessionService } from '../../src/session/port.js';
import { SessionLayer } from '../../src/session/session.js';
import type { SessionStoreState } from '../../src/session/types.js';
import { assetsDirOf } from '../../src/session/paths.js';
import { encodeProjectPath } from '../../src/util/path.js';
import { assetNameFor, MAX_MEDIA_PER_TURN } from '../../src/session/assets.js';
import { useTempProjectBase } from '../helpers/project-base.js';
import { incomingText } from '../helpers/parts.js';

const base = useTempProjectBase();

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(SessionLayer) as any));
}

function either<T>(eff: Effect.Effect<T, any, any>): Promise<Either.Either<T, any>> {
  return Effect.runPromise(Effect.either(eff.pipe(Effect.provide(SessionLayer)) as any));
}

function newDir(): string {
  const dir = join(base.dir, randomUUID());
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir: string): void {
  rmSync(join(base.dir, encodeProjectPath(dir)), { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
}

async function newSession(
  dir: string,
  opts?: { parentSessionId?: string; agentName?: string }
): Promise<SessionStoreState> {
  return run(
    Effect.gen(function* () {
      const svc = yield* SessionService;
      return yield* svc.create(
        dir,
        { model: 'test-model', activeProfile: 'build', permissionMode: 'askBeforeExec' },
        opts
      );
    })
  );
}

/** 只搭出嗅探需要的头十来个字节。 */
function mediaBytes(kind: 'png' | 'wav' | 'txt'): Uint8Array {
  if (kind === 'png') {
    const b = new Uint8Array(33);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    b[15] = 13;
    b.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
    b[18] = 0x01;
    b[19] = 0x40; // width 320（big-endian）
    b[23] = 0xf0; // height 240
    return b;
  }
  if (kind === 'wav') {
    const b = new Uint8Array(44);
    b.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
    b.set([0x57, 0x41, 0x56, 0x45], 8); // WAVE
    b.set([0x66, 0x6d, 0x74, 0x20], 12); // fmt
    b[16] = 16;
    b[24] = 0x40;
    b[25] = 0x1f; // sampleRate 8000
    b[28] = 0x40;
    b[29] = 0x1f; // byteRate 8000
    b[36] = 0x64;
    b[37] = 0x61;
    b[38] = 0x74; // 'dat'
    b[39] = 0x61; // 'a'  ⇒ 'data'
    b[40] = 0x40;
    b[41] = 0x1f; // dataSize 8000 ⇒ 1 秒
    return b;
  }
  const b = new Uint8Array(64);
  for (let i = 0; i < b.length; i++) b[i] = 0x20 + (i % 60);
  return b;
}

describe('SessionService.materializeInput', () => {
  it('纯文本原样通过且顺序保留', async () => {
    const dir = newDir();
    try {
      const state = await newSession(dir);
      const parts = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.materializeInput(state, [incomingText('a')[0]!, incomingText('b')[0]!]);
        })
      );
      expect(parts).toEqual([
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ]);
    } finally {
      cleanup(dir);
    }
  });

  it('媒体落进项目 assets 目录，mime 取嗅探结果并带上宽高 / 时长', async () => {
    const dir = newDir();
    try {
      const state = await newSession(dir);
      const png = mediaBytes('png');
      const wav = mediaBytes('wav');
      const parts = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.materializeInput(state, [
            { type: 'text', text: '看这张图' },
            // declaredMimeType 与真实字节不符：准入只看嗅探
            { type: 'media', bytes: png, declaredMimeType: 'audio/mpeg', filename: 'x.wav' },
            { type: 'media', bytes: wav, filename: 'sound.wav' },
          ]);
        })
      );

      const assetDir = assetsDirOf(state.cwd);
      expect(parts).toHaveLength(3);
      expect(parts[0]).toEqual({ type: 'text', text: '看这张图' });
      expect(parts[1]).toMatchObject({
        type: 'media',
        mimeType: 'image/png',
        bytes: png.byteLength,
        filename: 'x.wav',
        width: 320,
        height: 240,
      });
      expect(parts[2]).toMatchObject({
        type: 'media',
        mimeType: 'audio/wav',
        bytes: wav.byteLength,
        durationSec: 1,
      });

      const names = readdirSync(assetDir).sort();
      expect(names).toEqual([
        assetNameFor(png, 'image/png'),
        assetNameFor(wav, 'audio/wav'),
      ].sort());
      // 转录目录下不落媒体：assets 与 sessions 并列
      expect(existsSync(join(assetDir, '..', 'sessions', assetNameFor(png, 'image/png')))).toBe(
        false
      );
    } finally {
      cleanup(dir);
    }
  });

  it('同一份字节在两个会话里各落一次，assets 下仍只有一份', async () => {
    const dir = newDir();
    try {
      const png = mediaBytes('png');
      const first = await newSession(dir);
      const second = await newSession(dir);
      for (const state of [first, second]) {
        await run(
          Effect.gen(function* () {
            const svc = yield* SessionService;
            return yield* svc.materializeInput(state, [{ type: 'media', bytes: png }]);
          })
        );
      }
      expect(readdirSync(assetsDirOf(dir))).toEqual([assetNameFor(png, 'image/png')]);
    } finally {
      cleanup(dir);
    }
  });

  it('白名单外的字节 → INVALID_INPUT，且不落任何文件', async () => {
    const dir = newDir();
    try {
      const state = await newSession(dir);
      const res = await either(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.materializeInput(state, [
            { type: 'media', bytes: mediaBytes('txt'), declaredMimeType: 'image/png' },
          ]);
        })
      );
      expect(Either.isLeft(res)).toBe(true);
      if (Either.isLeft(res)) expect((res.left as any).code).toBe('INVALID_INPUT');
      expect(existsSync(assetsDirOf(dir))).toBe(false);
    } finally {
      cleanup(dir);
    }
  });

  it('单回合媒体数量超上限 → INVALID_INPUT', async () => {
    const dir = newDir();
    try {
      const state = await newSession(dir);
      const png = mediaBytes('png');
      const tooMany = Array.from({ length: MAX_MEDIA_PER_TURN + 1 }, () => ({
        type: 'media' as const,
        bytes: png,
      }));
      const res = await either(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.materializeInput(state, tooMany);
        })
      );
      expect(Either.isLeft(res)).toBe(true);
      if (Either.isLeft(res)) expect((res.left as any).code).toBe('INVALID_INPUT');
    } finally {
      cleanup(dir);
    }
  });

  it('子会话不接受媒体', async () => {
    const dir = newDir();
    try {
      const child = await newSession(dir, { parentSessionId: 'parent-1', agentName: 'reviewer' });
      const res = await either(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.materializeInput(child, [
            { type: 'media', bytes: mediaBytes('png') },
          ]);
        })
      );
      expect(Either.isLeft(res)).toBe(true);
      if (Either.isLeft(res)) expect((res.left as any).code).toBe('INVALID_INPUT');
    } finally {
      cleanup(dir);
    }
  });
});

describe('SessionService.resolveAssets', () => {
  it('命中资产返回 data URL，未命中的资产直接跳过', async () => {
    const dir = newDir();
    try {
      const state = await newSession(dir);
      const png = mediaBytes('png');
      const parts = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.materializeInput(state, [{ type: 'media', bytes: png }]);
        })
      );
      const asset = (parts[0] as any).asset as string;

      const resolved = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          return yield* svc.resolveAssets(state, [asset, 'deadbeef'.repeat(4) + '.png']);
        })
      );

      expect(resolved.get(asset)).toBe(`data:image/png;base64,${Buffer.from(png).toString('base64')}`);
      expect(resolved.has('deadbeef'.repeat(4) + '.png')).toBe(false);
    } finally {
      cleanup(dir);
    }
  });

  it('同一资产第二次解析走缓存：盘上文件被删掉也仍能解析', async () => {
    const dir = newDir();
    try {
      // assetCache 挂在 SessionLayer 内部：三次调用必须共用同一层实例
      const { first, second } = await run(
        Effect.gen(function* () {
          const svc = yield* SessionService;
          const state = yield* svc.create(
            dir,
            { model: 'test-model', activeProfile: 'build', permissionMode: 'askBeforeExec' }
          );
          const png = mediaBytes('png');
          const parts = yield* svc.materializeInput(state, [{ type: 'media', bytes: png }]);
          const asset = (parts[0] as any).asset as string;

          const first = yield* svc.resolveAssets(state, [asset]);
          unlinkSync(join(assetsDirOf(state.cwd), asset));
          const second = yield* svc.resolveAssets(state, [asset]);
          return { first: first.get(asset), second: second.get(asset) };
        })
      );

      expect(second).toBe(first);
    } finally {
      cleanup(dir);
    }
  });
});
