import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { AgentIdResolver } from '../../src/agent-state/agent-id.js';

function run<T>(eff: Effect.Effect<T, any, AgentIdResolver>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(AgentIdResolver.Default)));
}

/** Helper: get the resolver then run a test fn */

describe('AgentIdResolver', () => {
  it('should return same agentId for same sessionId', async () => {
    const program = Effect.gen(function* () {
      const svc = yield* AgentIdResolver;
      svc.reset();
      const a = svc.resolve('session-a');
      const b = svc.resolve('session-a');
      expect(a).toBe(b);
    });
    await run(program);
  });

  it('should return different agentId for different sessionId', async () => {
    const program = Effect.gen(function* () {
      const svc = yield* AgentIdResolver;
      svc.reset();
      const a = svc.resolve('session-x');
      const b = svc.resolve('session-y');
      expect(a).not.toBe(b);
    });
    await run(program);
  });

  it('should honor bind() with a custom id', async () => {
    const program = Effect.gen(function* () {
      const svc = yield* AgentIdResolver;
      svc.reset();
      svc.bind('custom-session', 'my-agent-1');
      expect(svc.resolve('custom-session')).toBe('my-agent-1');
    });
    await run(program);
  });

  it('should generate new ids after reset()', async () => {
    const program = Effect.gen(function* () {
      const svc = yield* AgentIdResolver;
      svc.reset();
      const before = svc.resolve('ephemeral');
      svc.reset();
      const after = svc.resolve('ephemeral');
      expect(after).not.toBe(before);
    });
    await run(program);
  });

  it('should generate UUIDs by default', async () => {
    const program = Effect.gen(function* () {
      const svc = yield* AgentIdResolver;
      svc.reset();
      const id = svc.resolve('uuid-test');
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
    await run(program);
  });
});
