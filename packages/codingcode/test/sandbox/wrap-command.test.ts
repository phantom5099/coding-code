import { describe, it, expect } from 'vitest';
import { Effect, Layer } from 'effect';
import { SandboxService } from '../../src/sandbox/index.js';

const TestLayer = SandboxService.Default;

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(TestLayer) as any));
}

describe('SandboxService', () => {
  it('should not be available by default (no @vscode/sandbox-runtime)', async () => {
    const result = await run(Effect.gen(function* () {
      const sandbox = yield* SandboxService;
      return sandbox.isAvailable();
    }));
    expect(result).toBe(false);
  });

  it('should wrapCommand passthrough when not available', async () => {
    const result = await run(Effect.gen(function* () {
      const sandbox = yield* SandboxService;
      return yield* sandbox.wrapCommand('echo hello');
    }));
    expect(result).toBe('echo hello');
  });

  it('should initialize gracefully when @vscode/sandbox-runtime is not installed', async () => {
    const result = await run(Effect.gen(function* () {
      const sandbox = yield* SandboxService;
      yield* sandbox.initialize({});
      return sandbox.isAvailable();
    }));
    expect(result).toBe(false);
  });

  it('should cleanup gracefully even when not initialized', async () => {
    await run(Effect.gen(function* () {
      const sandbox = yield* SandboxService;
      yield* sandbox.cleanup();
    }));
    // Should not throw
  });

  it('should execute command via fallback when sandbox unavailable', async () => {
    const result = await run(Effect.gen(function* () {
      const sandbox = yield* SandboxService;
      return yield* sandbox.execute({ command: 'echo hello', timeoutMs: 5000 });
    }));
    expect(result.stdout).toContain('hello');
  });
});
