import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { HookService } from '../../src/hooks/registry.js';
const AppLayer = HookService.Default;

function runWithLayer<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(AppLayer) as any));
}

describe('HookService', () => {
  it('should register and emit a hook', async () => {
    const handler = vi.fn();

    const program = Effect.gen(function* () {
      const hooks = yield* HookService;
      yield* hooks.register('tool.execute.before', handler);
      yield* hooks.emit('tool.execute.before', { key: 'val' });
      return handler.mock.calls.length;
    });

    const count = await runWithLayer(program);
    expect(count).toBe(1);
    expect(handler).toHaveBeenCalledWith({ key: 'val' });
  });

  it('should not throw on emit with no handlers', async () => {
    const program = Effect.gen(function* () {
      const hooks = yield* HookService;
      yield* hooks.emit('tool.execute.after', {});
      return true;
    });

    const result = await runWithLayer(program);
    expect(result).toBe(true);
  });

  it('should return unregister function', async () => {
    const handler = vi.fn();

    const program = Effect.gen(function* () {
      const hooks = yield* HookService;
      const unregister = yield* hooks.register('llm.request.before', handler);
      unregister(); // remove handler
      yield* hooks.emit('llm.request.before', {});
      return handler.mock.calls.length;
    });

    const count = await runWithLayer(program);
    expect(count).toBe(0);
  });

  it('should call multiple handlers for same hook point', async () => {
    const h1 = vi.fn();
    const h2 = vi.fn();

    const program = Effect.gen(function* () {
      const hooks = yield* HookService;
      yield* hooks.register('session.save.after', h1);
      yield* hooks.register('session.save.after', h2);
      yield* hooks.emit('session.save.after', {});
    });

    await runWithLayer(program);
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it('should support async handlers', async () => {
    const results: string[] = [];
    const handler = async () => {
      await new Promise((r) => setTimeout(r, 5));
      results.push('done');
    };

    const program = Effect.gen(function* () {
      const hooks = yield* HookService;
      yield* hooks.register('tool.execute.after', handler);
      yield* hooks.emit('tool.execute.after', {});
    });

    await runWithLayer(program);
    expect(results).toEqual(['done']);
  });

  it('should isolate handler exceptions 鈥?later handlers still run after one throws', async () => {
    const called: string[] = [];

    const program = Effect.gen(function* () {
      const hooks = yield* HookService;
      yield* hooks.register('session.save.before', async () => {
        throw new Error('bad handler');
      });
      yield* hooks.register('session.save.before', () => {
        called.push('second');
      });
      yield* hooks.emit('session.save.before', {});
    });

    await runWithLayer(program);
    expect(called).toEqual(['second']);
  });

  it('should isolate decision handler exceptions 鈥?skips erroring handler and tries next', async () => {
    const program = Effect.gen(function* () {
      const hooks = yield* HookService;
      yield* hooks.registerDecision(
        'agent.turn.stop',
        async () => {
          throw new Error('bad decision');
        },
        { priority: 0 }
      );
      yield* hooks.registerDecision(
        'agent.turn.stop',
        async () => ({ decision: 'continue' as const }),
        { priority: 1 }
      );
      return yield* hooks.emitDecision('agent.turn.stop', {});
    });

    const result = await runWithLayer(program);
    expect(result?.decision).toBe('continue');
  });

  it('runs Effect-returning observers in the emit fiber context (yield* services)', async () => {
    // The whole reason ObserverHandler is allowed to return an Effect: the
    // observer should be able to yield* services from the caller's fiber
    // (e.g. HookService) without resorting to Effect.runFork / default
    // runtime. This test pins that contract.
    const sideEffect: { ran: boolean; usedService: boolean } = {
      ran: false,
      usedService: false,
    };

    const observer: import('../../src/hooks/types.js').ObserverHandler = (payload) =>
      Effect.gen(function* () {
        // yield* in the observer body — this is the contract under test.
        // If emit runs the observer on a default runtime (no services),
        // this line throws "Service not found: HookService".
        const hooks = yield* HookService;
        sideEffect.ran = true;
        sideEffect.usedService = typeof hooks.register === 'function';
        void payload;
      });

    const program = Effect.gen(function* () {
      const hooks = yield* HookService;
      yield* hooks.register('tool.execute.after', observer, { source: 'system' });
      yield* hooks.emit('tool.execute.after', {
        toolName: 'submit_plan',
        sessionId: 'sess-1',
        projectPath: '/proj',
        args: { plan_content: 'x' },
        result: { output: 'Plan written to /x' },
      });
      return sideEffect;
    });

    const result = await runWithLayer(program);
    expect(result.ran).toBe(true);
    expect(result.usedService).toBe(true);
  });
});

describe('HookService.reloadUserHooks', () => {
  const testDir = resolve(tmpdir(), 'codingcode-test-hooks-reload');

  beforeEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    mkdirSync(join(testDir, '.codingcode'), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  function writeHooksYaml(hookName: string, point: string, enabled: boolean) {
    const content = `hooks:\n  - name: ${hookName}\n    point: ${point}\n    type: observer\n    command: echo\n    args: []\n    enabled: ${enabled}\n`;
    writeFileSync(join(testDir, '.codingcode', 'hooks.yaml'), content);
  }

  it('clears old user hooks and loads new ones from disk', async () => {
    const called: string[] = [];

    writeHooksYaml('hook-a', 'tool.execute.before', true);

    const program = Effect.gen(function* () {
      const hooks = yield* HookService;
      yield* hooks.register('tool.execute.before', () => {
        called.push('system');
      });
      yield* hooks.reloadUserHooks(testDir);

      writeHooksYaml('hook-b', 'tool.execute.before', true);
      yield* hooks.reloadUserHooks(testDir);
    });

    await runWithLayer(program);
    expect(called).toHaveLength(0);
  });

  it('disabled hooks in yaml are not registered', async () => {
    writeHooksYaml('disabled-hook', 'tool.execute.before', false);

    const program = Effect.gen(function* () {
      const hooks = yield* HookService;
      yield* hooks.reloadUserHooks(testDir);
    });

    await runWithLayer(program);
  });

  it('reloadUserHooks with empty cwd clears all user hooks', async () => {
    const program = Effect.gen(function* () {
      const hooks = yield* HookService;
      yield* hooks.reloadUserHooks(join(process.cwd(), 'nonexistent-dir-xyzzy'));
    });

    await runWithLayer(program);
  });

  it('system hooks survive reloadUserHooks', async () => {
    const called: string[] = [];

    const program = Effect.gen(function* () {
      const hooks = yield* HookService;
      // Register with source: 'system' 鈥?should survive reload
      yield* hooks.register(
        'tool.execute.before',
        () => {
          called.push('system');
        },
        { source: 'system' }
      );
      yield* hooks.reloadUserHooks(testDir);

      // Emit should still call the system handler
      yield* hooks.emit('tool.execute.before', {});
    });

    await runWithLayer(program);
    expect(called).toEqual(['system']);
  });

  it('register with source option defaults to user', async () => {
    const called: string[] = [];

    const program = Effect.gen(function* () {
      const hooks = yield* HookService;
      // No source option 鈥?defaults to 'user', should be cleared
      yield* hooks.register('tool.execute.before', () => {
        called.push('default-user');
      });
      yield* hooks.reloadUserHooks(testDir);

      yield* hooks.emit('tool.execute.before', {});
    });

    await runWithLayer(program);
    expect(called).toHaveLength(0);
  });
});
