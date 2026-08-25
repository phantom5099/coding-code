import { describe, expect, it } from 'vitest';
import { Effect, Layer } from 'effect';
import { z } from 'zod';
import { ApprovalService } from '../../src/approval/index.js';
import { HookService } from '../../src/hooks/registry.js';
import { ToolExecutorService } from '../../src/tools/executor.js';
import type { ToolDefinition, ToolExecCtx } from '../../src/tools/types.js';

const hooks = {
  emit: () => Effect.void,
};

const approval = {
  evaluate: () => Effect.succeed({ type: 'allow' as const }),
};

const executorLayer = ToolExecutorService.Default.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(HookService, hooks as any),
      Layer.succeed(ApprovalService, approval as any)
    )
  )
);

describe('ToolExecutorService context', () => {
  it('passes execution context to a tool without per-tool type annotations', async () => {
    let received: ToolExecCtx | undefined;
    const tool: ToolDefinition = {
      name: 'capture_context',
      description: 'Captures execution context for verification.',
      parameters: z.object({}),
      execute: (_args, ctx) => {
        received = ctx;
        return Effect.succeed('ok');
      },
    };
    const signal = new AbortController().signal;

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const executor = yield* ToolExecutorService;
        return yield* executor.execute(
          'capture_context',
          {},
          {
            signal,
            sessionId: 'session-1',
            turnId: 2,
            projectPath: '/project',
            toolLookup: (name) => (name === tool.name ? tool : undefined),
          }
        );
      }).pipe(Effect.provide(executorLayer) as any)
    );

    expect((result as { output: string }).output).toBe('ok');
    expect(received).toEqual({
      signal,
      sessionId: 'session-1',
      turnId: 2,
      projectPath: '/project',
    });
  });
});
