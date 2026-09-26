import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// 必须排在 hooks.js 前面：vi.mock 工厂要引用 fakeSpawn
import { resetFakeSpawn, whenCommand, fakeSpawn } from '../hooks/fake-spawn.js';
import { Effect } from 'effect';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { HookService } from '../../src/hooks/port.js';
import { HookLayer } from '../../src/hooks/hooks.js';
import { _setGlobalConfigDir } from '../../src/hooks/config.js';

vi.mock('child_process', () => ({
  spawn: (command: string, args: string[]) => fakeSpawn(command, args),
}));

describe('agent.turn.stop 的决策类型推断', () => {
  const testDir = resolve(tmpdir(), 'codingcode-test-stop-decision');
  const globalDir = resolve(tmpdir(), 'codingcode-test-stop-decision-global');

  beforeEach(() => {
    resetFakeSpawn();
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    if (existsSync(globalDir)) rmSync(globalDir, { recursive: true, force: true });
    mkdirSync(join(testDir, '.codingcode'), { recursive: true });
    mkdirSync(globalDir, { recursive: true });
    _setGlobalConfigDir(globalDir);
  });

  afterEach(() => {
    _setGlobalConfigDir(undefined);
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    if (existsSync(globalDir)) rmSync(globalDir, { recursive: true, force: true });
  });

  it('emitDecision 直接给出 HookDecision，读 decision / injection 不需要 any', async () => {
    writeFileSync(
      join(testDir, '.codingcode', 'hooks.yaml'),
      'hooks:\n  - name: loop\n    point: agent.turn.stop\n    type: decision\n    command: cmd-loop\n    args: []\n'
    );
    whenCommand('cmd-loop', { stdout: '{"decision":"continue","injection":"(test continue)"}' });

    const program = Effect.gen(function* () {
      const hooks = yield* HookService;
      yield* hooks.reloadUserHooks(testDir);
      const stopDecision = yield* hooks.emitDecision('agent.turn.stop', {
        projectPath: testDir,
        sessionId: 'test-sid',
        content: 'hello',
        turnId: 1,
      });
      // 类型级检查：stopDecision 是 HookDecision | null，下面两行必须无 `as any` 通过编译
      return stopDecision?.decision === 'continue' ? stopDecision.injection : null;
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(HookLayer) as any));
    expect(result).toBe('(test continue)');
  });
});
