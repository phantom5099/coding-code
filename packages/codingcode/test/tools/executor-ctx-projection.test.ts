import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { Effect, Layer } from 'effect';
import { ToolExecutorLayer, ToolExecutorService, makeToolRegistryLayer } from '@codingcode/tool';
import { HookService } from '@codingcode/hook';
import type { ToolBatchContext, ToolDefinition, ToolExecCtx } from '@codingcode/tool';

/**
 * 探针工具：临时挂进内置表，从真实执行路径（executeBatch → execute → 投影）
 * 里把「工具实际收到的那份 ctx」抓出来。
 *
 * 投影是 ToolBatchContext → ToolExecCtx 的收窄口子，这里钉住它的
 * 两条契约：可见字段一个不少，编排私有字段一个不漏。
 */
const PROBE = '__ctx_probe';

let captured: ToolExecCtx | undefined;

const probeTool: ToolDefinition = {
  name: PROBE,
  description: '探针：记录收到的 ctx',
  parameters: z.object({}),
  execute: (_args, ctx) => {
    captured = ctx;
    return Effect.succeed('ok');
  },
};

function hooksStub() {
  return {
    emit: () => Effect.succeed(undefined),
    emitDecision: () => Effect.succeed(null),
    reloadUserHooks: () => Effect.succeed(undefined),
  };
}

function runProbe(ctx: ToolBatchContext): Promise<void> {
  const program = Effect.gen(function* () {
    const exec = yield* ToolExecutorService;
    const catalog = yield* exec.prepare();
    yield* exec.executeBatch({
      toolCalls: [{ id: 'c1', name: PROBE, arguments: {} }],
      context: ctx,
      toolLookup: catalog.lookup,
    });
  });
  // prepare 的 catalog 只依赖 HookService 与 ToolRegistryService，其余服务与探针无关
  const live = ToolExecutorLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(HookService, hooksStub() as any),
        makeToolRegistryLayer([probeTool])
      )
    )
  );
  return Effect.runPromise(Effect.asVoid(program).pipe(Effect.provide(live)));
}

describe('工具执行上下文投影', () => {
  beforeEach(() => {
    captured = undefined;
  });

  it('可见字段一个不少：由 ToolBatchContext 与 session 投影到 ToolExecCtx', async () => {
    const signal = new AbortController().signal;
    await runProbe({
      session: { cwd: '/proj', sessionId: 'sess-1', currentTurnId: 7 },
      signal,
      model: 'm-1',
    });

    expect(captured).toBeDefined();
    // 精确断言键集合：既防漏抄，也防多塞
    expect(Object.keys(captured!).sort()).toEqual([
      'callId',
      'model',
      'sandboxPolicy',
      'session',
      'signal',
    ]);
    expect(captured!.session).toEqual({ cwd: '/proj', sessionId: 'sess-1' });
    expect(captured!.callId).toBe('c1');
    expect(captured!.model).toBe('m-1');
    expect(captured!.signal).toBe(signal);
  });

  it('currentTurnId 到不了工具，callId 以 tc.id 透传', async () => {
    await runProbe({
      session: { cwd: '/proj', sessionId: 'sess-1', currentTurnId: 7 },
      model: 'm-1',
    });

    expect(captured).toBeDefined();
    expect('turnId' in captured!).toBe(false);
    expect('currentTurnId' in captured!).toBe(false);
    expect('currentTurnId' in (captured!.session ?? {})).toBe(false);
    expect(captured!.callId).toBe('c1');
  });

  it('可选字段缺省时不伪造对应键', async () => {
    await runProbe({
      session: { cwd: '/proj', sessionId: '', currentTurnId: 1 },
      model: 'm-1',
    });

    expect(captured!.session).toEqual({ cwd: '/proj', sessionId: '' });
    expect('signal' in captured!).toBe(false);
    expect('parentChain' in (captured!.session ?? {})).toBe(false);
    expect('agentName' in captured!).toBe(false);
    expect(captured!.model).toBe('m-1');
  });
});
