import { describe, it, expect } from 'vitest';
import { Effect, Layer, Queue } from 'effect';
import { SubagentRunRegistryLayer, SubagentRunRegistryService } from '../../src/subagent/registry.js';
import { SubagentRunnerService } from '../../src/subagent/port.js';
import { MailboxLayer, MailboxService } from '../../src/session/mailbox.js';
import { EventSinkService } from '../../src/sink/port.js';
import { HookService } from '../../src/hooks/port.js';
import { TurnRegistryLayer } from '../../src/turn/registry.js';
import { TurnRegistryService } from '../../src/turn/port.js';
import type { FrameBody } from '../../src/sink/types.js';

const spawnOpts = {
  prompt: 'do a thing',
  agentName: 'build',
  parentSessionId: 'parent-1',
  parentCwd: '/tmp',
  parentProfile: 'build' as const,
  model: 'test-model',
};

/** 立刻发一条 text_delta 与终态 */
function doneStream(text = 'child-done'): AsyncGenerator<FrameBody> {
  return (async function* () {
    yield { family: 'event', event: { type: 'text_delta', text } } as FrameBody;
    yield { family: 'transition', transition: { to: 'end', reason: 'done' } } as FrameBody;
  })();
}

/** 永不结束：用来制造 hang */
function hangingStream(): AsyncGenerator<FrameBody> {
  return (async function* () {
    await new Promise((r) => setTimeout(r, 30_000));
    yield { family: 'transition', transition: { to: 'end', reason: 'done' } } as FrameBody;
  })();
}

/** 以 error 终态收尾 */
function failStream(): AsyncGenerator<FrameBody> {
  return (async function* () {
    yield {
      family: 'transition',
      transition: { to: 'end', reason: 'error', error: { message: 'boom', code: 'X' } },
    } as FrameBody;
  })();
}

function makeHarness(makeStream: () => AsyncGenerator<FrameBody>) {
  const emitted: Array<{ sessionId: string; body: FrameBody }> = [];
  let n = 0;
  const runner = Layer.succeed(SubagentRunnerService, {
    runSubagent: (_prompt: string, _opts: any) =>
      Effect.sync(() => ({ stream: makeStream(), sessionId: `child-${++n}` })),
  } as any);
  const sink = Layer.succeed(EventSinkService, {
    attach: () => Effect.succeed(Effect.runSync(Queue.unbounded<FrameBody>())),
    detach: () => Effect.void,
    emit: (sessionId: string, body: FrameBody) =>
      Effect.sync(() => {
        emitted.push({ sessionId, body });
      }),
  } as any);
  const hooks = Layer.succeed(HookService, {
    emit: () => Effect.void,
    emitDecision: () => Effect.succeed(null),
    reloadUserHooks: () => Effect.void,
  } as any);

  const turn = TurnRegistryLayer.pipe(Layer.provide(sink));
  const layers = SubagentRunRegistryLayer.pipe(
    Layer.provideMerge(Layer.mergeAll(runner, MailboxLayer, sink, hooks, turn))
  );
  return { emitted, layers };
}

const run = <T>(layers: Layer.Layer<any>, eff: Effect.Effect<T, any, any>): Promise<T> =>
  Effect.runPromise(eff.pipe(Effect.provide(layers)) as unknown as Effect.Effect<T, never, never>);

describe('subagent run registry', () => {
  it('spawn 立即返回句柄，不等子代理结束', async () => {
    const { layers } = makeHarness(hangingStream);
    const result = await run(
      layers,
      Effect.gen(function* () {
        const reg = yield* SubagentRunRegistryService;
        const started = Date.now();
        const handle = yield* reg.spawn(spawnOpts);
        return { handle, elapsed: Date.now() - started };
      })
    );
    expect(result.handle).toEqual({ sessionId: 'child-1', agentName: 'build' });
    expect(result.elapsed).toBeLessThan(500);
  });

  it('spawn 时向父会话投递 spawned 帧', async () => {
    const { layers, emitted } = makeHarness(hangingStream);
    await run(
      layers,
      Effect.gen(function* () {
        const reg = yield* SubagentRunRegistryService;
        yield* reg.spawn(spawnOpts);
      })
    );
    expect(emitted[0]?.sessionId).toBe('parent-1');
    expect(emitted[0]?.body).toMatchObject({
      family: 'event',
      event: {
        type: 'subagent_event',
        sessionId: 'child-1',
        agentName: 'build',
        status: 'spawned',
      },
    });
  });

  it('终态到达后：结果进父会话 mailbox，且 completed 帧投给父会话', async () => {
    const { layers, emitted } = makeHarness(() => doneStream('hello'));
    const result = await run(
      layers,
      Effect.gen(function* () {
        const reg = yield* SubagentRunRegistryService;
        const mb = yield* MailboxService;
        yield* reg.spawn(spawnOpts);
        // 让后台 drain fiber 跑完
        yield* Effect.sleep(50);
        return yield* mb.drain('parent-1');
      })
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: 'subagent_result',
      sessionId: 'child-1',
      agentName: 'build',
    });
    expect(result[0]!.content).toContain('hello');
    expect(result[0]!.content).toContain('Message Type: FINAL_ANSWER');

    const statuses = emitted
      .map((e) => (e.body.family === 'event' ? (e.body.event as any).status : undefined))
      .filter(Boolean);
    expect(statuses).toEqual(['spawned', 'completed']);
  });

  it('error 终态：mailbox 正文含失败原因', async () => {
    const { layers } = makeHarness(failStream);
    const result = await run(
      layers,
      Effect.gen(function* () {
        const reg = yield* SubagentRunRegistryService;
        const mb = yield* MailboxService;
        yield* reg.spawn(spawnOpts);
        yield* Effect.sleep(50);
        return yield* mb.drain('parent-1');
      })
    );
    expect(result[0]!.content).toContain('boom');
    expect(result[0]!.content).toContain('did not finish');
  });

  it('配额：超过 maxBackground 时拒绝新的 spawn（并发闸走状态表）', async () => {
    const { layers } = makeHarness(hangingStream);
    const result = await run(
      layers,
      Effect.gen(function* () {
        const reg = yield* SubagentRunRegistryService;
        const turn = yield* TurnRegistryService;
        const outcomes: string[] = [];
        // 并发闸先判、再 spawn、成功后才 claim 占位（与 runTurn 的真实顺序一致）
        for (let i = 1; i <= 6; i++) {
          const r = yield* Effect.either(reg.spawn(spawnOpts));
          outcomes.push(r._tag);
          if (r._tag === 'Right') {
            yield* turn.claim(r.right.sessionId, { turnId: 1, parentSessionId: 'parent-1' });
          }
        }
        return outcomes;
      })
    );
    // 默认上限 4：前四个成功，之后被拒
    expect(result).toEqual(['Right', 'Right', 'Right', 'Right', 'Left', 'Left']);
  });

  it('stopChildren 只停仍在跑的派生会话（句柄由 arm 登记）', async () => {
    const { layers } = makeHarness(hangingStream);
    const result = await run(
      layers,
      Effect.gen(function* () {
        const reg = yield* SubagentRunRegistryService;
        const turn = yield* TurnRegistryService;
        for (let i = 0; i < 2; i++) {
          const sid = `child-${i + 1}`;
          yield* turn.claim(sid, { turnId: 1, parentSessionId: 'parent-1' });
          const stopped: string[] = [];
          yield* turn.arm(sid, () => stopped.push(sid));
          yield* reg.spawn(spawnOpts);
        }
        const first = yield* turn.stopChildren('parent-1');
        const second = yield* turn.stopChildren('parent-1');
        return { first, second };
      })
    );
    expect(result.first).toBe(2);
    expect(result.second).toBe(0);
  });
});
