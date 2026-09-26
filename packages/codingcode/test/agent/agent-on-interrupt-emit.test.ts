import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// 必须排在 hooks.js 前面：vi.mock 工厂要引用 fakeSpawn
import { spawnRecords, resetFakeSpawn, fakeSpawn } from '../hooks/fake-spawn.js';
import { Effect, Fiber } from 'effect';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { HookService } from '../../src/hooks/port.js';
import { HookLayer } from '../../src/hooks/hooks.js';
import { useTempHome } from '../helpers/temp-home.js';

vi.mock('child_process', () => ({
  spawn: (command: string, args: string[]) => fakeSpawn(command, args),
}));

// 这个文件钉住 agent.ts 里 `Effect.onInterrupt` 回调的修法（`agent.turn.end` 在 abort 时的 emit）。
// 旧代码把 emit 包在 `Effect.sync(() => { Effect.runPromise(emit) })` 里，会开一个**没有服务上下文**的新
// fiber —— 回调里 `yield* HookService` 会直接 Die（"Service not found"）。修法是把回调写成
// `Effect.gen` 并 `yield*` emit，让它跑在 agent 的 fiber 里。
//
// 断言方式：用 hooks.yaml 定义一个观察者。回调里 `const hooks = yield* HookService` 若失败，
// emit 根本不会发生、子进程不会被 spawn。所以「spawn 被调到」即证明服务解析成功。

describe('Effect.onInterrupt 回调里 yield* HookService + emit（agent.ts abort 修法）', () => {
  const testDir = resolve(tmpdir(), 'codingcode-test-oninterrupt-emit');
  // 全局层落在临时 home 里，避免读到开发机上的 ~/.codingcode（全局配置目录不可指定）
  useTempHome('codingcode-test-oninterrupt-emit-');

  beforeEach(() => {
    resetFakeSpawn();
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    mkdirSync(join(testDir, '.codingcode'), { recursive: true });
    writeFileSync(
      join(testDir, '.codingcode', 'hooks.yaml'),
      'hooks:\n  - name: on-abort\n    point: agent.turn.end\n    type: observer\n    command: cmd-abort\n    args: []\n'
    );
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('被中断时回调能解析出 HookService 并把 agent.turn.end 跑出去', async () => {
    const program = Effect.gen(function* () {
      const hooks = yield* HookService;
      yield* hooks.reloadUserHooks(testDir);
      // 永远挂起，唯一的出口是被 Fiber.interrupt，从而触发 onInterrupt 回调
      yield* Effect.never;
    }).pipe(
      Effect.onInterrupt(() =>
        Effect.gen(function* () {
          const hooks = yield* HookService;
          yield* hooks
            .emit('agent.turn.end', { projectPath: testDir, status: 'aborted' })
            .pipe(Effect.ignore);
        })
      )
    );

    const fiber = Effect.runFork(Effect.provide(program, HookLayer));
    // 让 reloadUserHooks 先跑完
    await new Promise((resolve) => setTimeout(resolve, 10));
    await Effect.runPromise(Fiber.interrupt(fiber));
    // 让 onInterrupt 回调里的 emit 有机会跑完
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(spawnRecords.map((r) => r.command)).toEqual(['cmd-abort']);
    expect(spawnRecords[0]!.payload).toMatchObject({ status: 'aborted' });
  });
});
