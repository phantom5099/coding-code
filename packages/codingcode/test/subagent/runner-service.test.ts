import { expect, it, describe } from 'vitest';
import { Effect, Layer } from 'effect';
import { SubagentRunnerService } from '../../src/subagent/port.js';

describe('SubagentRunnerService', () => {
  it('should be a valid Effect Service with the SubagentRunner tag', () => {
    expect(SubagentRunnerService.key).toBe('SubagentRunner');
  });

  it('should allow creating a Layer with a custom runSubagent implementation', async () => {
    const mockRunSubagent = (_input: string, _opts: { cwd: string }) =>
      Effect.succeed({
        stream: (async function* () {
          yield { _tag: 'Done' as const, content: 'test-result' };
        })(),
        sessionId: 'child-1',
      });

    const testLayer = Layer.succeed(SubagentRunnerService, { runSubagent: mockRunSubagent } as any);

    const result: any = await Effect.runPromise(
      (
        Effect.gen(function* () {
          const runner = yield* SubagentRunnerService;
          return runner;
        }) as any
      ).pipe(Effect.provide(testLayer as any))
    );

    expect(result.runSubagent).toBe(mockRunSubagent);
  });

  it('should allow runSubagent to be called and produce events', async () => {
    const events: any[] = [];
    const mockRunSubagent = (_input: string, _opts: { cwd: string }) =>
      Effect.succeed({
        stream: (async function* () {
          yield { _tag: 'Done' as const, content: 'test-result' };
        })(),
        sessionId: 'child-1',
      });

    const testLayer = Layer.succeed(SubagentRunnerService, { runSubagent: mockRunSubagent } as any);

    const result: any = await Effect.runPromise(
      (
        Effect.gen(function* () {
          const runner = yield* SubagentRunnerService;
          const { stream, sessionId } = yield* runner.runSubagent('go', { cwd: '/test' });
          expect(sessionId).toBe('child-1');
          // Consume the async generator outside the Effect generator
          return yield* Effect.async<any, never>((resume) => {
            (async () => {
              for await (const event of stream) {
                events.push(event);
              }
              resume(Effect.succeed(events));
            })();
          });
        }) as any
      ).pipe(Effect.provide(testLayer as any))
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ _tag: 'Done', content: 'test-result' });
  });
});
