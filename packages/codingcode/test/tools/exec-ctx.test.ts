import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { ToolService } from '../../src/tools/registry.js';
import { ToolExecutorService } from '../../src/tools/executor.js';
import { ApprovalService } from '../../src/approval/index.js';
import { AppLayer } from '../../src/layer.js';
import type { ToolDefinition, ToolExecCtx } from '../../src/tools/types.js';
import { z } from 'zod';

function runWithLayer<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(AppLayer) as any));
}

/** Add an allow-all rule for a tool name pattern to bypass the default-deny pipeline. */
function allowTool(name: string) {
  return Effect.gen(function* () {
    const approval = yield* ApprovalService;
    yield* approval.addRule({
      id: `test-allow-${name}`,
      action: 'allow',
      toolPattern: name,
      reason: 'test permission',
    });
  });
}

describe('ToolExecCtx propagation', () => {
  it('should pass complete ctx to tool execute', async () => {
    const captured: ToolExecCtx[] = [];

    const stubTool: ToolDefinition = {
      name: 'ctx_capture',
      description: 'captures ctx',
      parameters: z.object({}),
      execute: async (_args: unknown, ctx?: ToolExecCtx) => {
        captured.push(ctx ?? {});
        return 'done';
      },
    };

    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      const executor = yield* ToolExecutorService;
      yield* tools.register(stubTool);
      yield* allowTool('ctx_capture');
      const result = yield* executor.execute(
        'ctx_capture',
        {},
        {
          signal: undefined,
          sessionId: 'sess-1',
          turnId: 5,
          projectPath: '/proj',
        }
      );
      return result;
    });

    await runWithLayer(program);
    expect(captured).toHaveLength(1);
    expect(captured[0].sessionId).toBe('sess-1');
    expect(captured[0].turnId).toBe(5);
    expect(captured[0].projectPath).toBe('/proj');
  });

  it('should pass sessionId when provided without other optional fields', async () => {
    const captured: ToolExecCtx[] = [];

    const stubTool: ToolDefinition = {
      name: 'ctx_no_agent',
      description: 'captures ctx',
      parameters: z.object({}),
      execute: async (_args: unknown, ctx?: ToolExecCtx) => {
        captured.push(ctx ?? {});
        return 'done';
      },
    };

    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      const executor = yield* ToolExecutorService;
      yield* tools.register(stubTool);
      yield* allowTool('ctx_no_agent');
      yield* executor.execute(
        'ctx_no_agent',
        {},
        {
          sessionId: 'sess-2',
          turnId: 1,
          projectPath: '/proj',
        }
      );
    });

    await runWithLayer(program);
    expect(captured).toHaveLength(1);
    expect(captured[0].sessionId).toBe('sess-2');
  });
});
