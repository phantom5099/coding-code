import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { Effect, Layer } from 'effect';
import { ToolExecutorLayer } from '../../src/tools/tools.js';
import { ToolExecutorService } from '../../src/tools/port.js';
import { HookService } from '../../src/hooks/port.js';
import { TOOLS_BY_NAME } from '../../src/tools/catalog.js';
import type { ToolDefinition, ToolExecCtx, ToolExecOpts } from '../../src/tools/types.js';

/**
 * 探针工具：临时挂进内置表，从真实执行路径（executeBatch → execute → 投影）
 * 里把「工具实际收到的那份 ctx」抓出来。
 *
 * 投影是 ToolExecOpts/ToolExecCall → ToolExecCtx 的收窄口子，这里钉住它的
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

function runProbe(opts: ToolExecOpts, sessionId: string | undefined): Promise<void> {
  const program = Effect.gen(function* () {
    const exec = yield* ToolExecutorService;
    const catalog = yield* exec.prepare([PROBE]);
    yield* catalog.executeBatch([{ id: 'c1', name: PROBE, arguments: {} }], sessionId, opts);
  });
  // prepare 的 catalog 只依赖 HookService，其余服务与探针无关
  const live = ToolExecutorLayer.pipe(Layer.provide(Layer.succeed(HookService, hooksStub() as any)));
  return Effect.runPromise(Effect.asVoid(program).pipe(Effect.provide(live)));
}

describe('工具执行上下文投影', () => {
  beforeEach(() => {
    captured = undefined;
    TOOLS_BY_NAME.set(PROBE, probeTool);
  });

  afterEach(() => {
    TOOLS_BY_NAME.delete(PROBE);
  });

  it('可见字段一个不少：sessionId 由位置参数并入，其余从 opts 流过', async () => {
    const signal = new AbortController().signal;
    await runProbe({ turnId: 7, projectPath: '/proj', signal, activeProfile: 'plan', model: 'm-1' }, 'sess-1');

    expect(captured).toBeDefined();
    // 精确断言键集合：既防漏抄，也防多塞
    expect(Object.keys(captured!).sort()).toEqual([
      'activeProfile',
      'model',
      'projectPath',
      'sessionId',
      'signal',
    ]);
    expect(captured!.sessionId).toBe('sess-1');
    expect(captured!.projectPath).toBe('/proj');
    expect(captured!.activeProfile).toBe('plan');
    expect(captured!.model).toBe('m-1');
    expect(captured!.signal).toBe(signal);
  });

  it('编排私有字段一个不漏：turnId / callId 到不了工具', async () => {
    await runProbe({ turnId: 7, projectPath: '/proj', model: 'm-1' }, 'sess-1');

    expect(captured).toBeDefined();
    expect('turnId' in captured!).toBe(false);
    expect('callId' in captured!).toBe(false);
  });

  it('sessionId 缺省时不伪造该字段', async () => {
    await runProbe({ projectPath: '/proj', model: 'm-1' }, undefined);

    // 键仍在（位置参数是显式传的），值为 undefined —— 与旧的手写投影行为一致
    expect(captured!.sessionId).toBeUndefined();
    expect(captured!.model).toBe('m-1');
  });
});
