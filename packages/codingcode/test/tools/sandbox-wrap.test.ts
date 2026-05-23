import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect, Layer } from 'effect';
import { ToolService } from '../../src/tools/registry.js';
import { ToolExecutorService } from '../../src/tools/executor.js';
import { SandboxService } from '../../src/sandbox/index.js';
import { ApprovalService } from '../../src/approval/index.js';
import { AppLayer } from '../../src/layer.js';
import type { ToolDefinition, ToolExecCtx } from '../../src/tools/types.js';
import { z } from 'zod';

function runWithLayer<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(AppLayer) as any));
}

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

describe('SandboxService integration with ToolExecutor', () => {
  it('should pass sandbox.wrapCommand to tool ctx', async () => {
    const captured: ToolExecCtx[] = [];

    const stubTool: ToolDefinition = {
      name: 'capture_sandbox_ctx',
      description: 'captures ctx to verify sandbox',
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
      yield* allowTool('capture_sandbox_ctx');
      yield* executor.execute('capture_sandbox_ctx', {}, {
        sessionId: 'sess-1',
      });
    });

    await runWithLayer(program);
    expect(captured).toHaveLength(1);
    expect(captured[0].sandbox).toBeDefined();
    expect(typeof captured[0].sandbox?.wrapCommand).toBe('function');
  });

  it('should wrapCommand function work (passthrough when sandbox unavailable)', async () => {
    const wrappedResults: string[] = [];

    const stubTool: ToolDefinition = {
      name: 'test_wrap_cmd',
      description: 'test wrap command',
      parameters: z.object({}),
      execute: async (_args: unknown, ctx?: ToolExecCtx) => {
        if (ctx?.sandbox) {
          const wrapped = await ctx.sandbox.wrapCommand('echo test');
          wrappedResults.push(wrapped);
        }
        return 'done';
      },
    };

    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      const executor = yield* ToolExecutorService;
      yield* tools.register(stubTool);
      yield* allowTool('test_wrap_cmd');
      yield* executor.execute('test_wrap_cmd', {}, {
        sessionId: 'sess-2',
      });
    });

    await runWithLayer(program);
    expect(wrappedResults).toHaveLength(1);
    // When sandbox is unavailable, wrapCommand returns original command
    expect(wrappedResults[0]).toBe('echo test');
  });
});
