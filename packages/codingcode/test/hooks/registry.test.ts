import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// 这个 import 必须排在 hooks.js 前面：vi.mock 的工厂要用 fakeSpawn，
// 而工厂会在 hooks.js 首次 import child_process 时执行。
import { spawnRecords, whenCommand, resetFakeSpawn, fakeSpawn } from './fake-spawn.js';
import { Effect } from 'effect';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { HookService } from '../../src/hooks/port.js';
import { HookLayer } from '../../src/hooks/hooks.js';
import { useTempHome } from '../helpers/temp-home.js';

const AppLayer = HookLayer;

function runWithLayer<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(AppLayer) as any));
}

vi.mock('child_process', () => ({
  spawn: (command: string, args: string[]) => fakeSpawn(command, args),
}));

describe('HookService.emit（YAML 定义的观察者）', () => {
  const testDir = resolve(tmpdir(), 'codingcode-test-hooks-emit');
  // 全局层落在临时 home 里，避免读到开发机上的 ~/.codingcode（全局配置目录不可指定）
  const tempHome = useTempHome('codingcode-test-hooks-emit-');

  beforeEach(() => {
    resetFakeSpawn();
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    mkdirSync(join(testDir, '.codingcode'), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  interface HookLine {
    name: string;
    point: string;
    type?: 'observer' | 'decision';
    command: string;
    priority?: number;
    enabled?: boolean;
  }

  function hookYaml(hooks: HookLine[]): string {
    const lines = hooks.map((h) => {
      const parts = [
        `  - name: ${h.name}`,
        `    point: ${h.point}`,
        `    type: ${h.type ?? 'observer'}`,
        `    command: ${h.command}`,
        '    args: []',
      ];
      if (h.priority !== undefined) parts.push(`    priority: ${h.priority}`);
      if (h.enabled !== undefined) parts.push(`    enabled: ${h.enabled}`);
      return parts.join('\n');
    });
    return `hooks:\n${lines.join('\n')}\n`;
  }

  function writeHooksYaml(hooks: HookLine[]) {
    writeFileSync(join(testDir, '.codingcode', 'hooks.yaml'), hookYaml(hooks));
  }

  function writeGlobalHooksYaml(hooks: HookLine[]) {
    mkdirSync(tempHome.configDir, { recursive: true });
    writeFileSync(join(tempHome.configDir, 'hooks.yaml'), hookYaml(hooks));
  }

  it('把 hooks.yaml 里的观察者注册到对应点，并把 payload 原样送进子进程 stdin', async () => {
    writeHooksYaml([{ name: 'h-a', point: 'tool.execute.before', command: 'cmd-a' }]);

    await runWithLayer(
      Effect.gen(function* () {
        const hooks = yield* HookService;
        yield* hooks.reloadUserHooks(testDir);
        yield* hooks.emit('tool.execute.before', { projectPath: testDir, toolName: 'read_file' });
      })
    );

    expect(spawnRecords).toHaveLength(1);
    expect(spawnRecords[0]!.command).toBe('cmd-a');
    expect(spawnRecords[0]!.payload).toEqual({ projectPath: testDir, toolName: 'read_file' });
  });

  it('emit 在没有 handler 的点上是 no-op：不抛错、不 spawn', async () => {
    await runWithLayer(
      Effect.gen(function* () {
        const hooks = yield* HookService;
        yield* hooks.emit('tool.execute.after', { projectPath: testDir });
      })
    );
    expect(spawnRecords).toHaveLength(0);
  });

  it('enabled: false 的 hook 不注册', async () => {
    writeHooksYaml([
      { name: 'off', point: 'tool.execute.before', command: 'cmd-off', enabled: false },
    ]);

    await runWithLayer(
      Effect.gen(function* () {
        const hooks = yield* HookService;
        yield* hooks.reloadUserHooks(testDir);
        yield* hooks.emit('tool.execute.before', { projectPath: testDir });
      })
    );

    expect(spawnRecords).toHaveLength(0);
  });

  it('同一点的多个观察者按 priority 升序依次执行', async () => {
    writeHooksYaml([
      { name: 'late', point: 'tool.execute.before', command: 'cmd-late', priority: 20 },
      { name: 'early', point: 'tool.execute.before', command: 'cmd-early', priority: 10 },
      { name: 'zero', point: 'tool.execute.before', command: 'cmd-zero' },
    ]);

    await runWithLayer(
      Effect.gen(function* () {
        const hooks = yield* HookService;
        yield* hooks.reloadUserHooks(testDir);
        yield* hooks.emit('tool.execute.before', { projectPath: testDir });
      })
    );

    expect(spawnRecords.map((r) => r.command)).toEqual(['cmd-zero', 'cmd-early', 'cmd-late']);
  });

  it('reloadUserHooks 替换上一次注册的，不累积', async () => {
    writeHooksYaml([{ name: 'first', point: 'tool.execute.before', command: 'cmd-first' }]);

    const program = (label: string) =>
      Effect.gen(function* () {
        const hooks = yield* HookService;
        yield* hooks.reloadUserHooks(testDir);
        yield* hooks.emit('tool.execute.before', { projectPath: testDir, label });
      });

    await runWithLayer(program('one'));
    expect(spawnRecords).toHaveLength(1);

    writeHooksYaml([{ name: 'second', point: 'tool.execute.before', command: 'cmd-second' }]);
    await runWithLayer(program('two'));

    expect(spawnRecords.map((r) => r.command)).toEqual(['cmd-first', 'cmd-second']);
  });

  it('hook 只在它所属的 projectPath 下生效', async () => {
    writeHooksYaml([{ name: 'h-a', point: 'tool.execute.before', command: 'cmd-a' }]);

    await runWithLayer(
      Effect.gen(function* () {
        const hooks = yield* HookService;
        yield* hooks.reloadUserHooks(testDir);
        yield* hooks.emit('tool.execute.before', { projectPath: '/somewhere/else' });
        yield* hooks.emit('tool.execute.before', { projectPath: undefined });
        yield* hooks.emit('tool.execute.before', { projectPath: testDir });
      })
    );

    expect(spawnRecords).toHaveLength(1);
  });

  it('单个观察者失败不阻断后面的观察者，emit 也不失败', async () => {
    writeHooksYaml([
      { name: 'bad', point: 'tool.execute.before', command: 'cmd-bad', priority: 1 },
      { name: 'good', point: 'tool.execute.before', command: 'cmd-good', priority: 2 },
    ]);
    whenCommand('cmd-bad', { error: new Error('boom') });

    const result = await runWithLayer(
      Effect.gen(function* () {
        const hooks = yield* HookService;
        yield* hooks.reloadUserHooks(testDir);
        yield* hooks.emit('tool.execute.before', { projectPath: testDir });
        return 'emit survived';
      })
    );

    expect(result).toBe('emit survived');
    // cmd-bad 挂在 error 上（error 先于 close，记录已入），cmd-good 必须照跑
    expect(spawnRecords.map((r) => r.command)).toEqual(['cmd-bad', 'cmd-good']);
  });

  it('reloadUserHooks 指向不存在的目录时不注册任何 hook', async () => {
    await runWithLayer(
      Effect.gen(function* () {
        const hooks = yield* HookService;
        yield* hooks.reloadUserHooks(join(testDir, 'nope'));
        yield* hooks.emit('tool.execute.before', { projectPath: join(testDir, 'nope') });
      })
    );
    expect(spawnRecords).toHaveLength(0);
  });

  it('emit 把 payload 的全部字段（含非字符串值）序列化给子进程', async () => {
    writeHooksYaml([{ name: 'h-a', point: 'tool.execute.after', command: 'cmd-a' }]);

    await runWithLayer(
      Effect.gen(function* () {
        const hooks = yield* HookService;
        yield* hooks.reloadUserHooks(testDir);
        yield* hooks.emit('tool.execute.after', {
          projectPath: testDir,
          toolName: 'write_file',
          durationMs: 42,
          args: { path: '/tmp/x', content: 'hi' },
        });
      })
    );

    expect(spawnRecords[0]!.payload).toEqual({
      projectPath: testDir,
      toolName: 'write_file',
      durationMs: 42,
      args: { path: '/tmp/x', content: 'hi' },
    });
  });

  it('只在全局层定义的 hook 在项目层没写任何东西时照常生效', async () => {
    writeGlobalHooksYaml([{ name: 'g', point: 'tool.execute.before', command: 'cmd-global' }]);

    await runWithLayer(
      Effect.gen(function* () {
        const hooks = yield* HookService;
        yield* hooks.reloadUserHooks(testDir);
        yield* hooks.emit('tool.execute.before', { projectPath: testDir });
      })
    );

    expect(spawnRecords.map((r) => r.command)).toEqual(['cmd-global']);
  });

  it('项目层用 {name, enabled:false} 最小补丁就能关掉全局定义的 hook', async () => {
    writeGlobalHooksYaml([
      { name: 'stays', point: 'tool.execute.before', command: 'cmd-stays', priority: 1 },
      { name: 'killed', point: 'tool.execute.before', command: 'cmd-killed', priority: 2 },
    ]);
    // 只写 name + enabled，不复制 command/point，靠字段级合并继承全局的其余字段
    writeFileSync(
      join(testDir, '.codingcode', 'hooks.yaml'),
      'hooks:\n  - name: killed\n    enabled: false\n'
    );

    await runWithLayer(
      Effect.gen(function* () {
        const hooks = yield* HookService;
        yield* hooks.reloadUserHooks(testDir);
        yield* hooks.emit('tool.execute.before', { projectPath: testDir });
      })
    );

    expect(spawnRecords.map((r) => r.command)).toEqual(['cmd-stays']);
  });
});
