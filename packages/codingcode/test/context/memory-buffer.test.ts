import { describe, it, expect, vi } from 'vitest';
import { Effect, Layer } from 'effect';
import { ContextService } from '@codingcode/context';
import type { ContextShape } from '@codingcode/context';
import { ContextLayer } from '@codingcode/context';
import { SessionService } from '@codingcode/session';
import { LLMService } from '@codingcode/model';
import { EventSinkLayer } from '@codingcode/sink';
import { TurnRegistryLayer } from '@codingcode/turn';
import type { SessionEvent } from '@codingcode/session';
import type { SessionRef } from '@codingcode/session';
import { text } from '../helpers/parts.js';
import { textOf } from '@codingcode/model';

// 上下文窗口钉死成可控值（与其余 context 用例一致）
const windowState = vi.hoisted(() => ({ value: 128000 }));
vi.mock('@codingcode/model', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,

  contextWindowOf: () => windowState.value,
  };
});

const SUMMARY =
  '## Compacted History\n\n### Goal\nx\n\n### Instructions\ny\n\n### Discoveries\nz\n\n### Accomplished\nw\n\n### Relevant Files\nf';

/** 计数 + 内存中的假 transcript：把「读盘」变成可断言的数字 */
function makeCountingSession(seed: SessionEvent[]) {
  const reads = { count: 0 };
  const appended: SessionEvent[] = [];
  const svc = {
    readEvents: () =>
      Effect.sync(() => {
        reads.count++;
        return [...seed, ...appended];
      }),
    appendEvent: (_locator: unknown, ev: SessionEvent) =>
      Effect.sync(() => {
        appended.push(ev);
      }),
  };
  return { svc, reads, appended };
}

function makeLayer(counting: ReturnType<typeof makeCountingSession>, summary = SUMMARY) {
  const sessionLayer = Layer.succeed(SessionService, counting.svc as any);
  const llmLayer = Layer.succeed(LLMService, {
    complete: () => Effect.succeed({ content: summary }),
    completeStream: () => (async function* () {})(),
  } as any);
  return ContextLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        sessionLayer,
        llmLayer,
        EventSinkLayer,
        TurnRegistryLayer.pipe(Layer.provide(EventSinkLayer))
      )
    )
  );
}

async function getCtx(counting: ReturnType<typeof makeCountingSession>): Promise<ContextShape> {
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* ContextService;
    }).pipe(Effect.provide(makeLayer(counting)) as any)
  );
}

const REF: SessionRef = { cwd: '/tmp', sessionId: 's1', currentTurnId: 1 };

function seedEvents(): SessionEvent[] {
  return [
    {
      type: 'session_meta',
      sessionId: 's1',
      cwd: '/tmp',
      createdAt: new Date().toISOString(),
      model: 'test-model',
      title: 't',

      permissionMode: 'askBeforeExec',
    },
    { type: 'user', turnId: 1, content: text('q1') },
  ];
}

describe('context memory buffer', () => {
  it('回合内多次 getHistory 只读一次盘', async () => {
    const counting = makeCountingSession(seedEvents());
    const ctx = await getCtx(counting);

    for (let i = 0; i < 3; i++) {
      await Effect.runPromise(ctx.getHistory({ session: REF, model: 'test-model' }));
    }

    expect(counting.reads.count).toBe(1);
  });

  it('换回合（turnId 变化）后重读一次盘', async () => {
    const counting = makeCountingSession(seedEvents());
    const ctx = await getCtx(counting);

    await Effect.runPromise(ctx.getHistory({ session: REF, model: 'test-model' }));
    await Effect.runPromise(ctx.getHistory({ session: { ...REF, currentTurnId: 2 }, model: 'test-model' }));

    expect(counting.reads.count).toBe(2);
  });

  it('absorb 的事件在下一步立即可见，且不触发回盘', async () => {
    const counting = makeCountingSession(seedEvents());
    const ctx = await getCtx(counting);

    await Effect.runPromise(ctx.getHistory({ session: REF, model: 'test-model' }));
    await Effect.runPromise(
      ctx.absorb(REF, [{ type: 'assistant', turnId: 1, content: 'r1', toolCalls: [] }])
    );
    const messages = await Effect.runPromise(ctx.getHistory({ session: REF, model: 'test-model' }));

    expect(messages.some((m) => textOf(m.content) === 'r1')).toBe(true);
    expect(counting.reads.count).toBe(1);
  });

  it('absorb 早于首次 getHistory 时是 no-op（事件本就在盘上）', async () => {
    const counting = makeCountingSession(seedEvents());
    const ctx = await getCtx(counting);

    await Effect.runPromise(ctx.absorb(REF, [{ type: 'user', turnId: 1, content: text('early') }]));
    const messages = await Effect.runPromise(ctx.getHistory({ session: REF, model: 'test-model' }));

    expect(counting.reads.count).toBe(1);
    expect(messages.some((m) => textOf(m.content) === 'q1')).toBe(true);
  });

  it('跨回合 drain 到已写盘的结果：按 uuid 判重，不重复注入', async () => {
    const event: SessionEvent = {
      type: 'subagent_result',
      uuid: 'sr-1',
      sessionId: 'child-1',
      agentName: 'build',
      content: 'Message Type: FINAL_ANSWER\nTask name: parent-1\nSender: child-1\nPayload:\nhi',
    };
    const counting = makeCountingSession([...seedEvents(), event]);
    const ctx = await getCtx(counting);
    // 上一回合投递、本回合才被 drain 到：事件早已随读盘进了 buffer
    const ref: SessionRef = { ...REF, currentTurnId: 2 };

    await Effect.runPromise(ctx.getHistory({ session: ref, model: 'test-model' }));
    await Effect.runPromise(ctx.absorb(ref, [event]));
    const messages = await Effect.runPromise(ctx.getHistory({ session: ref, model: 'test-model' }));

    expect(messages.filter((m) => textOf(m.content).includes('FINAL_ANSWER'))).toHaveLength(1);
  });

  it('压缩轮不再额外读盘', async () => {
    windowState.value = 1000;
    try {
      const big = 'X'.repeat(8000);
      const counting = makeCountingSession([
        ...seedEvents(),
        {
          type: 'assistant',
          turnId: 1,
          content: 'r1',
          toolCalls: [{ id: 'tc1', name: 'bash', arguments: {} }],
        },
        { type: 'tool_result', turnId: 1, toolName: 'bash', toolCallId: 'tc1', output: big },
      ]);
      const ctx = await getCtx(counting);

      const messages = await Effect.runPromise(
        ctx.getHistory({ session: { ...REF, currentTurnId: 3 }, model: 'test-model' })
      );

      expect(messages.some((m) => m.name === 'compacted_history')).toBe(true);
      expect(counting.reads.count).toBe(1);
    } finally {
      windowState.value = 128000;
    }
  });

  it('dispose 后缓存被清，下次 getHistory 重新读盘', async () => {
    const counting = makeCountingSession(seedEvents());
    const ctx = await getCtx(counting);

    await Effect.runPromise(ctx.getHistory({ session: REF, model: 'test-model' }));
    await Effect.runPromise(ctx.dispose(REF.sessionId));
    await Effect.runPromise(ctx.getHistory({ session: REF, model: 'test-model' }));

    expect(counting.reads.count).toBe(2);
  });
});
