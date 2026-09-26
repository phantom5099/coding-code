import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// 必须排在 hooks.js 前面：vi.mock 工厂要引用 fakeSpawn
import { spawnRecords, whenCommand, resetFakeSpawn, fakeSpawn } from './fake-spawn.js';
import { Effect } from 'effect';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { HookService } from '../../src/hooks/port.js';
import { HookLayer } from '../../src/hooks/hooks.js';
import { _setGlobalConfigDir } from '../../src/hooks/config.js';

const TestLayer = HookLayer;

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(TestLayer) as any));
}

vi.mock('child_process', () => ({
  spawn: (command: string, args: string[]) => fakeSpawn(command, args),
}));

interface HookLine {
  name: string;
  point: string;
  type: 'observer' | 'decision';
  command: string;
  priority?: number;
}

describe('HookService.emitDecision（YAML 定义的决策 hook）', () => {
  const testDir = resolve(tmpdir(), 'codingcode-test-hooks-decision');
  const globalDir = resolve(tmpdir(), 'codingcode-test-hooks-decision-global');

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

  function writeHooksYaml(hooks: HookLine[]) {
    const lines = hooks.map((h) => {
      const parts = [
        `  - name: ${h.name}`,
        `    point: ${h.point}`,
        `    type: ${h.type}`,
        `    command: ${h.command}`,
        '    args: []',
      ];
      if (h.priority !== undefined) parts.push(`    priority: ${h.priority}`);
      return parts.join('\n');
    });
    writeFileSync(join(testDir, '.codingcode', 'hooks.yaml'), `hooks:\n${lines.join('\n')}\n`);
  }

  it('没有决策 hook 时返回 null，且不 spawn', async () => {
    const result = await run(
      Effect.gen(function* () {
        const hooks = yield* HookService;
        yield* hooks.reloadUserHooks(testDir);
        return yield* hooks.emitDecision('tool.approval.pre', { projectPath: testDir });
      })
    );

    expect(result).toBeNull();
    expect(spawnRecords).toHaveLength(0);
  });

  it('返回决策 hook 写到 stdout 的 JSON，并把 payload 送进 stdin', async () => {
    writeHooksYaml([
      { name: 'd', point: 'tool.approval.pre', type: 'decision', command: 'cmd-deny' },
    ]);
    whenCommand('cmd-deny', { stdout: '{"decision":"deny","reason":"blocked by policy"}' });

    const result = await run(
      Effect.gen(function* () {
        const hooks = yield* HookService;
        yield* hooks.reloadUserHooks(testDir);
        return yield* hooks.emitDecision('tool.approval.pre', {
          projectPath: testDir,
          toolName: 'Bash',
        });
      })
    );

    expect(result).toEqual({ decision: 'deny', reason: 'blocked by policy' });
    expect(spawnRecords[0]!.payload).toEqual({ projectPath: testDir, toolName: 'Bash' });
  });

  it('按 priority 升序取首个非 null 的决策，命中即不再跑后面的', async () => {
    writeHooksYaml([
      { name: 'null', point: 'tool.approval.pre', type: 'decision', command: 'cmd-null', priority: 1 },
      { name: 'deny', point: 'tool.approval.pre', type: 'decision', command: 'cmd-deny', priority: 2 },
      { name: 'never', point: 'tool.approval.pre', type: 'decision', command: 'cmd-never', priority: 3 },
    ]);
    whenCommand('cmd-deny', { stdout: '{"decision":"deny"}' });

    const result = await run(
      Effect.gen(function* () {
        const hooks = yield* HookService;
        yield* hooks.reloadUserHooks(testDir);
        return yield* hooks.emitDecision('tool.approval.pre', { projectPath: testDir });
      })
    );

    expect(result).toEqual({ decision: 'deny' });
    expect(spawnRecords.map((r) => r.command)).toEqual(['cmd-null', 'cmd-deny']);
  });

  it('非零退出降级为 null，落到下一个决策 hook', async () => {
    writeHooksYaml([
      { name: 'fail', point: 'tool.approval.pre', type: 'decision', command: 'cmd-fail', priority: 1 },
      { name: 'ask', point: 'tool.approval.pre', type: 'decision', command: 'cmd-ask', priority: 2 },
    ]);
    whenCommand('cmd-fail', { code: 1, stdout: '{"decision":"deny"}' });
    whenCommand('cmd-ask', { stdout: '{"decision":"ask"}' });

    const result = await run(
      Effect.gen(function* () {
        const hooks = yield* HookService;
        yield* hooks.reloadUserHooks(testDir);
        return yield* hooks.emitDecision('tool.approval.pre', { projectPath: testDir });
      })
    );

    expect(result).toEqual({ decision: 'ask' });
  });

  it('stdout 不是合法 JSON 时降级为 null，落到下一个决策 hook', async () => {
    writeHooksYaml([
      { name: 'junk', point: 'tool.approval.pre', type: 'decision', command: 'cmd-junk', priority: 1 },
      { name: 'allow', point: 'tool.approval.pre', type: 'decision', command: 'cmd-allow', priority: 2 },
    ]);
    whenCommand('cmd-junk', { stdout: 'not json at all' });
    whenCommand('cmd-allow', { stdout: '{"decision":"allow"}' });

    const result = await run(
      Effect.gen(function* () {
        const hooks = yield* HookService;
        yield* hooks.reloadUserHooks(testDir);
        return yield* hooks.emitDecision('tool.approval.pre', { projectPath: testDir });
      })
    );

    expect(result).toEqual({ decision: 'allow' });
  });

  it('观察者不参与 emitDecision', async () => {
    writeHooksYaml([
      { name: 'obs', point: 'tool.approval.pre', type: 'observer', command: 'cmd-obs' },
    ]);

    const result = await run(
      Effect.gen(function* () {
        const hooks = yield* HookService;
        yield* hooks.reloadUserHooks(testDir);
        return yield* hooks.emitDecision('tool.approval.pre', { projectPath: testDir });
      })
    );

    expect(result).toBeNull();
    expect(spawnRecords).toHaveLength(0);
  });

  it('决策 hook 不参与 emit', async () => {
    writeHooksYaml([
      { name: 'd', point: 'tool.execute.before', type: 'decision', command: 'cmd-deny' },
    ]);
    whenCommand('cmd-deny', { stdout: '{"decision":"deny"}' });

    await run(
      Effect.gen(function* () {
        const hooks = yield* HookService;
        yield* hooks.reloadUserHooks(testDir);
        yield* hooks.emit('tool.execute.before', { projectPath: testDir });
      })
    );

    expect(spawnRecords).toHaveLength(0);
  });

  it('continue 决策连同 injection 一起透传（agent.turn.stop 用）', async () => {
    writeHooksYaml([
      { name: 'loop', point: 'agent.turn.stop', type: 'decision', command: 'cmd-loop' },
    ]);
    whenCommand('cmd-loop', { stdout: '{"decision":"continue","injection":"keep going"}' });

    const result = await run(
      Effect.gen(function* () {
        const hooks = yield* HookService;
        yield* hooks.reloadUserHooks(testDir);
        return yield* hooks.emitDecision('agent.turn.stop', { projectPath: testDir, content: 'hi' });
      })
    );

    expect(result?.decision).toBe('continue');
    expect(result?.injection).toBe('keep going');
  });

  it('所有决策 hook 都返回 null 时整体返回 null', async () => {
    writeHooksYaml([
      { name: 'n1', point: 'tool.approval.pre', type: 'decision', command: 'cmd-n1', priority: 1 },
      { name: 'n2', point: 'tool.approval.pre', type: 'decision', command: 'cmd-n2', priority: 2 },
    ]);

    const result = await run(
      Effect.gen(function* () {
        const hooks = yield* HookService;
        yield* hooks.reloadUserHooks(testDir);
        return yield* hooks.emitDecision('tool.approval.pre', { projectPath: testDir });
      })
    );

    expect(result).toBeNull();
    // 两个都跑过（没有短路）
    expect(spawnRecords.map((r) => r.command)).toEqual(['cmd-n1', 'cmd-n2']);
  });
});
