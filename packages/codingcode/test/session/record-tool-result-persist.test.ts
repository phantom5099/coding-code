import { describe, it, expect, vi } from 'vitest';
import { Effect } from 'effect';
import { SessionService } from '../../src/session/store.js';

vi.mock('../../src/context/config.js', () => ({
  getContextConfig: vi.fn(() => ({
    microCompactThreshold: 0.5,
    microCompactMinChars: 120,
    compactionThreshold: 0.9,
    keepRecentTurns: 1,
    compactionModel: '',
    reactiveCompactMaxRetries: 3,
  })),
}));

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(SessionService.Default) as any));
}

describe('recordToolResult', () => {
  it('writes full output for all tool results', async () => {
    const state = await run(
      SessionService.pipe(Effect.flatMap((s) => s.create('/tmp/persist-test', 'test-model')))
    );

    const longOutput = 'x'.repeat(30000);
    const assistantEvent = await run(
      SessionService.pipe(
        Effect.flatMap((s) =>
          s.recordAssistant(
            state,
            'use tool',
            [{ id: 'tc1', name: 'bash', arguments: { cmd: 'echo' } }],
            'test-model'
          )
        )
      )
    );

    const event = await run(
      SessionService.pipe(
        Effect.flatMap((s) =>
          s.recordToolResult(state, assistantEvent.uuid, 'bash', 'tc1', longOutput)
        )
      )
    );

    expect(event.output).toBe(longOutput);
    expect(event.output).toHaveLength(30000);
  });

  it('writes full output for small tool results', async () => {
    const state = await run(
      SessionService.pipe(Effect.flatMap((s) => s.create('/tmp/persist-test-small', 'test-model')))
    );

    const shortOutput = 'small result';
    const assistantEvent = await run(
      SessionService.pipe(
        Effect.flatMap((s) =>
          s.recordAssistant(
            state,
            'use tool',
            [{ id: 'tc1', name: 'bash', arguments: { cmd: 'echo' } }],
            'test-model'
          )
        )
      )
    );

    const event = await run(
      SessionService.pipe(
        Effect.flatMap((s) =>
          s.recordToolResult(state, assistantEvent.uuid, 'bash', 'tc1', shortOutput)
        )
      )
    );

    expect(event.output).toBe(shortOutput);
  });
});
