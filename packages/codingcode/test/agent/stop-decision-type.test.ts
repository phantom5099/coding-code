import { describe, it, expect, vi } from 'vitest';
import { Effect } from 'effect';
import { Result } from '../../src/core/result';
import { HookService } from '../../src/hooks/registry.js';
import type { HookDecision } from '../../src/hooks/types.js';

describe('agent.turn.stop decision type inference', () => {
  it('should infer HookDecision from emitDecision without any cast', async () => {
    // Verify emitDecision returns a typed HookDecision that does NOT need `any`
    // to access `decision` and `injection` fields.
    const program = Effect.gen(function* () {
      const hooks = yield* HookService;
      yield* hooks.registerDecision('agent.turn.stop', () => ({
        decision: 'continue' as const,
        injection: '(test continue)',
      }));
      const stopDecision = yield* hooks.emitDecision('agent.turn.stop', {
        sessionId: 'test-sid',
        content: 'hello',
        turnId: 1,
      });
      // Type-level check: stopDecision should be HookDecision | null
      // This line must compile without `as any`.
      return stopDecision?.decision === 'continue' ? stopDecision.injection : null;
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(HookService.Default) as any)
    );
    expect(result).toBe('(test continue)');
  });
});
