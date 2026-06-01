import { describe, it, expect, vi } from 'vitest';
import { Effect } from 'effect';
import { SessionService } from '../../src/session/store.js';

vi.mock('../../src/context/config.js', () => ({
  getContextConfig: vi.fn(() => ({
    thresholdTokens: 8000,
    persistPreviewChars: 2000,
    compactionThreshold: 0.9,
    keepRecentTurns: 3,
    toolsExemptFromMicrocompact: ['Read', 'todo_write', 'todo_read', 'tool_search'],
    minTurnsBetweenCompactions: 5,
    compactionModel: '',
    reactiveCompactMaxRetries: 3,
    reactiveCompactKeepTurns: 3,
    snipMaxMessages: 50,
    toolResultBudgetThreshold: 50000,
    keepRecentToolResults: 3,
  })),
}));

function run<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(SessionService.Default) as any));
}

describe('recordToolResult proactive persist', () => {
  it('persists large tool results (> thresholdTokens) and replaces output', async () => {

    const state = await run(
      SessionService.pipe(Effect.flatMap((s) => s.create('/tmp/persist-test', 'test-model', '0.1.0'))),
    );

    const longOutput = 'x'.repeat(30000);
    const assistantEvent = await run(
      SessionService.pipe(Effect.flatMap((s) => s.recordAssistant(state, 'use tool', [{ id: 'tc1', name: 'bash', arguments: { cmd: 'echo' } }], 'test-model'))),
    );

    const event = await run(
      SessionService.pipe(Effect.flatMap((s) => s.recordToolResult(state, assistantEvent.uuid, 'bash', 'tc1', longOutput))),
    );

    expect(event.output).toContain('persisted at:');
    expect(event.output).toContain('x'.repeat(2000));
  });

  it('does NOT persist read tool results even if large', async () => {

    const state = await run(
      SessionService.pipe(Effect.flatMap((s) => s.create('/tmp/persist-test-read', 'test-model', '0.1.0'))),
    );

    const longOutput = 'x'.repeat(30000);
    const assistantEvent = await run(
      SessionService.pipe(Effect.flatMap((s) => s.recordAssistant(state, 'use tool', [{ id: 'tc1', name: 'read', arguments: { path: '/tmp/file.txt' } }], 'test-model'))),
    );

    const event = await run(
      SessionService.pipe(Effect.flatMap((s) => s.recordToolResult(state, assistantEvent.uuid, 'read', 'tc1', longOutput))),
    );

    expect(event.output).toBe(longOutput);
  });

  it('does NOT persist small tool results', async () => {

    const state = await run(
      SessionService.pipe(Effect.flatMap((s) => s.create('/tmp/persist-test-small', 'test-model', '0.1.0'))),
    );

    const shortOutput = 'small result';
    const assistantEvent = await run(
      SessionService.pipe(Effect.flatMap((s) => s.recordAssistant(state, 'use tool', [{ id: 'tc1', name: 'bash', arguments: { cmd: 'echo' } }], 'test-model'))),
    );

    const event = await run(
      SessionService.pipe(Effect.flatMap((s) => s.recordToolResult(state, assistantEvent.uuid, 'bash', 'tc1', shortOutput))),
    );

    expect(event.output).toBe(shortOutput);
  });
});

