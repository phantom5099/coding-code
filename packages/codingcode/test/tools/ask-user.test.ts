import { describe, it, expect, beforeEach } from 'vitest';
import { Effect, Exit, Fiber, Layer, ManagedRuntime } from 'effect';
import { askUserTool } from '../../src/tools/domains/self/ask-user.js';
import { AskWaitService, type AskAnswer } from '../../src/askuser/port.js';
import { AskWaitLayer } from '../../src/askuser/wait.js';
import { EventSinkService } from '../../src/sink/port.js';
import type { FrameBody } from '../../src/sink/types.js';

// ---------- 测试环境：真实 AskWaitLayer + 捕获型 EventSink mock ----------

const frames: FrameBody[] = [];

const SinkMockLayer = Layer.succeed(EventSinkService, {
  detach: () => Effect.void,
  emit: (_sessionId: string, body: FrameBody) =>
    Effect.sync(() => {
      frames.push(body);
    }),
} as any);

const rt = ManagedRuntime.make(Layer.mergeAll(AskWaitLayer, SinkMockLayer));

beforeEach(() => {
  frames.length = 0;
});

const CTX = { sessionId: 'sess-1', callId: 'tc-1', model: 'test-model' } as const;

/** 起一个 execute fiber，并以重试方式 resolve（emit 之后 waitForAsk 注册之间存在竞态） */
function askAndResolve(
  args: unknown,
  ctx: { sessionId: string; callId: string; model: string },
  answer: AskAnswer
) {
  return Effect.gen(function* () {
    const svc = yield* AskWaitService;
    const fiber = yield* Effect.fork(askUserTool.execute(args, ctx));
    let resolved = false;
    for (let i = 0; i < 500 && !resolved; i++) {
      resolved = yield* svc.resolveAsk(ctx.callId, ctx.sessionId, answer);
      if (!resolved) yield* Effect.sleep(2);
    }
    if (!resolved) throw new Error('ask entry never registered');
    return yield* Fiber.join(fiber);
  });
}

// ---------- 1. 参数校验 ----------

describe('ask_user 参数校验', () => {
  it('schema 拒绝非法 questiontype', async () => {
    await expect(
      askUserTool.parameters.parseAsync({ questiontype: 'checkbox', question: 'q' })
    ).rejects.toThrow();
  });

  it('schema 拒绝空 question', async () => {
    await expect(
      askUserTool.parameters.parseAsync({ questiontype: 'text', question: '' })
    ).rejects.toThrow();
  });

  it('schema 拒绝超过 4 个选项', async () => {
    await expect(
      askUserTool.parameters.parseAsync({
        questiontype: 'single',
        question: 'q',
        options: ['1', '2', '3', '4', '5'],
      })
    ).rejects.toThrow();
  });

  it('schema 拒绝空字符串选项', async () => {
    await expect(
      askUserTool.parameters.parseAsync({ questiontype: 'single', question: 'q', options: ['a', ''] })
    ).rejects.toThrow();
  });

  it('single 缺 options → AgentError', async () => {
    const err = await rt.runPromise(
      askUserTool.execute({ questiontype: 'single', question: 'q' }, CTX).pipe(Effect.flip)
    );
    expect(err.code).toBe('TOOL_EXECUTION_FAILED');
  });

  it('multiple 仅 1 个选项 → AgentError', async () => {
    const exit = await rt.runPromiseExit(
      askUserTool.execute({ questiontype: 'multiple', question: 'q', options: ['唯一'] }, CTX)
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('text 携带 options 被忽略且正常工作', async () => {
    const svc = await rt.runPromise(AskWaitService);
    const fiber = rt.runFork(
      askUserTool.execute(
        { questiontype: 'text', question: '什么颜色', options: ['红', '蓝'] },
        CTX
      )
    );
    await rt.runPromise(svc.resolveAsk('tc-1', 'sess-1', { status: 'answered', options: [], custom: '绿色' }));
    const output = await rt.runPromise(Fiber.join(fiber));
    expect(output).toBe('用户回答：绿色');
    // 帧不带 options
    const emitted = (frames[0] as { event: { options?: unknown } }).event;
    expect(emitted.options).toBeUndefined();
  });

  it('缺 sessionId → AgentError', async () => {
    const exit = await rt.runPromiseExit(
      askUserTool.execute(
        { questiontype: 'single', question: 'q', options: ['a', 'b'] },
        { callId: 'tc-1', model: 'm' }
      )
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('缺 callId → AgentError', async () => {
    const exit = await rt.runPromiseExit(
      askUserTool.execute(
        { questiontype: 'single', question: 'q', options: ['a', 'b'] },
        { sessionId: 's', model: 'm' }
      )
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

// ---------- 2 & 3. 等待-回流（真实 AskWaitLayer）与输出格式化 ----------

describe('ask_user 等待-回流与 output 格式', () => {
  it('单选：用户选择了：["A:红色"]', async () => {
    const output = await rt.runPromise(
      askAndResolve(
        { questiontype: 'single', question: '什么颜色', options: ['红色', '蓝色'] },
        CTX,
        { status: 'answered', options: ['A'], custom: null }
      )
    );
    expect(output).toBe('用户选择了：["A:红色"]');
  });

  it('多选：用户选择了：["A:红色","C:绿色"]', async () => {
    const output = await rt.runPromise(
      askAndResolve(
        { questiontype: 'multiple', question: '要哪些', options: ['红色', '蓝色', '绿色'] },
        CTX,
        { status: 'answered', options: ['A', 'C'], custom: null }
      )
    );
    expect(output).toBe('用户选择了：["A:红色","C:绿色"]');
  });

  it('仅自定义：用户选择了：["自定义：其他颜色"]', async () => {
    const output = await rt.runPromise(
      askAndResolve(
        { questiontype: 'single', question: '什么颜色', options: ['红色', '蓝色'] },
        CTX,
        { status: 'answered', options: [], custom: '其他颜色' }
      )
    );
    expect(output).toBe('用户选择了：["自定义：其他颜色"]');
  });

  it('选项+补充（多选；单选在前端与自定义输入互斥，不产生此形态）：["A:红色"]；补充', async () => {
    const output = await rt.runPromise(
      askAndResolve(
        { questiontype: 'multiple', question: '什么颜色', options: ['红色', '蓝色'] },
        CTX,
        { status: 'answered', options: ['A'], custom: '备注' }
      )
    );
    expect(output).toBe('用户选择了：["A:红色"]；用户补充输入：备注');
  });

  it('填空：用户回答：其他颜色', async () => {
    const output = await rt.runPromise(
      askAndResolve(
        { questiontype: 'text', question: '什么颜色' },
        CTX,
        { status: 'answered', options: [], custom: '其他颜色' }
      )
    );
    expect(output).toBe('用户回答：其他颜色');
  });

  it('非 A-D 的选项字母被过滤；越界字母不产出条目', async () => {
    const output = await rt.runPromise(
      askAndResolve(
        { questiontype: 'single', question: '什么颜色', options: ['红色', '蓝色'] },
        CTX,
        { status: 'answered', options: ['a', 'E', 'B'], custom: null }
      )
    );
    // 'a' 小写不匹配 /E/ 越界均被滤掉，仅保留 'B'
    expect(output).toBe('用户选择了：["B:蓝色"]');
  });

  it('emit 的 ask_user 帧自包含且 id 即 callId', async () => {
    await rt.runPromise(
      askAndResolve(
        { questiontype: 'single', question: '什么颜色', options: ['红色', '蓝色'] },
        CTX,
        { status: 'answered', options: ['A'], custom: null }
      )
    );
    expect(frames).toEqual([
      {
        family: 'event',
        event: {
          type: 'ask_user',
          id: 'tc-1',
          question: '什么颜色',
          questiontype: 'single',
          options: ['红色', '蓝色'],
        },
      },
    ]);
  });

  it('未 resolve 前一直挂起（回合不提前收场）', async () => {
    const output = await rt.runPromise(
      Effect.gen(function* () {
        const svc = yield* AskWaitService;
        const fiber = yield* Effect.fork(
          askUserTool.execute(
            { questiontype: 'single', question: 'q', options: ['a', 'b'] },
            CTX
          )
        );
        // 帧已发出，但 50ms 内不 resolve → join 竞速应输给 sleep（即仍挂起）
        const raced = yield* Effect.race(
          Fiber.join(fiber),
          Effect.sleep(50).pipe(Effect.as('still-hanging'))
        );
        expect(raced).toBe('still-hanging');
        // 收尾：resolve 让 fiber 干净退出
        yield* svc.resolveAsk('tc-1', 'sess-1', { status: 'answered', options: ['A'], custom: null });
        return yield* Fiber.join(fiber);
      })
    );
    expect(output).toBe('用户选择了：["A:a"]');
  });

  it('resolveAsk 未知 id 返回 false', async () => {
    const svc = await rt.runPromise(AskWaitService);
    const ok = await rt.runPromise(
      svc.resolveAsk('no-such-id', 'sess-1', { status: 'answered', options: ['A'], custom: null })
    );
    expect(ok).toBe(false);
  });

  it('跨 sessionId resolve 被拒绝', async () => {
    const svc = await rt.runPromise(AskWaitService);
    const fiber = rt.runFork(
      askUserTool.execute(
        { questiontype: 'single', question: 'q', options: ['a', 'b'] },
        CTX
      )
    );
    await Effect.runPromise(Effect.sleep(20));
    const ok = await rt.runPromise(
      svc.resolveAsk('tc-1', 'other-session', { status: 'answered', options: ['A'], custom: null })
    );
    expect(ok).toBe(false);
    // 正确会话仍可 resolve（条目未被污染）
    const ok2 = await rt.runPromise(
      svc.resolveAsk('tc-1', 'sess-1', { status: 'answered', options: ['A'], custom: null })
    );
    expect(ok2).toBe(true);
    expect(await rt.runPromise(Fiber.join(fiber))).toBe('用户选择了：["A:a"]');
  });

  it('同批两个 ask_user 并发挂起、分别 resolve 互不干扰', async () => {
    const output = await rt.runPromise(
      Effect.gen(function* () {
        const svc = yield* AskWaitService;
        const fiber1 = yield* Effect.fork(
          askUserTool.execute(
            { questiontype: 'single', question: '颜色', options: ['红色', '蓝色'] },
            { ...CTX, callId: 'tc-1' }
          )
        );
        const fiber2 = yield* Effect.fork(
          askUserTool.execute(
            { questiontype: 'text', question: '名字' },
            { ...CTX, callId: 'tc-2' }
          )
        );
        // 两个条目都注册后，先解 tc-2 再解 tc-1（乱序）
        for (let i = 0; i < 500; i++) {
          const framesOk = frames.length === 2;
          if (!framesOk) {
            yield* Effect.sleep(2);
            continue;
          }
          const r2 = yield* svc.resolveAsk('tc-2', 'sess-1', {
            status: 'answered',
            options: [],
            custom: '张三',
          });
          if (!r2) {
            yield* Effect.sleep(2);
            continue;
          }
          let r1 = false;
          for (let j = 0; j < 500 && !r1; j++) {
            r1 = yield* svc.resolveAsk('tc-1', 'sess-1', {
              status: 'answered',
              options: ['B'],
              custom: null,
            });
            if (!r1) yield* Effect.sleep(2);
          }
          if (!r1) throw new Error('tc-1 never registered');
          return yield* Effect.all([Fiber.join(fiber1), Fiber.join(fiber2)]);
        }
        throw new Error('frames never emitted');
      })
    );
    expect(output).toEqual([
      '用户选择了：["B:蓝色"]',
      '用户回答：张三',
    ]);
  });
});

// ---------- 4. fail-closed：取消 / 打断 ----------

describe('ask_user fail-closed 生命周期', () => {
  it('cancelPendingFor 后挂起的 execute 以 ok + 未回答文案收场，回合不挂起', async () => {
    const output = await rt.runPromise(
      Effect.gen(function* () {
        const svc = yield* AskWaitService;
        const fiber = yield* Effect.fork(
          askUserTool.execute(
            { questiontype: 'single', question: 'q', options: ['a', 'b'] },
            CTX
          )
        );
        // 等条目注册
        for (let i = 0; i < 500; i++) {
          const cleared = yield* svc.cancelPendingFor('sess-1');
          if (cleared > 0) break;
          yield* Effect.sleep(2);
        }
        return yield* Fiber.join(fiber);
      })
    );
    expect(output).toBe('用户未回答（用户取消或连接中断）');
  });

  it('cancelPendingFor 只清理本会话，返回清理条数', async () => {
    const count = await rt.runPromise(
      Effect.gen(function* () {
        const svc = yield* AskWaitService;
        yield* Effect.fork(
          askUserTool.execute(
            { questiontype: 'single', question: 'q', options: ['a', 'b'] },
            { ...CTX, callId: 'tc-a1', sessionId: 'sess-A' }
          )
        );
        yield* Effect.fork(
          askUserTool.execute(
            { questiontype: 'single', question: 'q', options: ['a', 'b'] },
            { ...CTX, callId: 'tc-b1', sessionId: 'sess-B' }
          )
        );
        yield* Effect.sleep(50); // 给两个条目留足注册时间
        return yield* svc.cancelPendingFor('sess-A');
      })
    );
    expect(count).toBe(1);
    // 收尾：清掉 sess-B 的残留条目，不污染后续测试
    const svc = await rt.runPromise(AskWaitService);
    await rt.runPromise(svc.cancelPendingFor('sess-B'));
  });

  it('fiber 被打断时 forget 清理等待条目，后续 resolve 落空', async () => {
    const noDangling = await rt.runPromise(
      Effect.gen(function* () {
        const svc = yield* AskWaitService;
        const fiber = yield* Effect.fork(
          askUserTool.execute(
            { questiontype: 'single', question: 'q', options: ['a', 'b'] },
            CTX
          )
        );
        // 等条目注册（注册后帧已发出）
        for (let i = 0; i < 500; i++) {
          if (frames.length > 0) break;
          yield* Effect.sleep(2);
        }
        yield* Effect.sleep(5); // waitForAsk 注册紧随 emit
        yield* Fiber.interrupt(fiber);
        return yield* svc.resolveAsk('tc-1', 'sess-1', {
          status: 'answered',
          options: ['A'],
          custom: null,
        });
      })
    );
    expect(noDangling).toBe(false);
  });

  it('正常完成后 forget 幂等（条目已被 resolveAsk 删除）', async () => {
    const result = await rt.runPromise(
      Effect.gen(function* () {
        const svc = yield* AskWaitService;
        const fiber = yield* Effect.fork(svc.waitForAsk('manual-1', 'sess-1'));
        // 等注册完成再 resolve（复用重试模式）
        let resolved = false;
        for (let i = 0; i < 500 && !resolved; i++) {
          resolved = yield* svc.resolveAsk('manual-1', 'sess-1', { status: 'no_answer' });
          if (!resolved) yield* Effect.sleep(2);
        }
        const forgot = yield* svc.forget('manual-1');
        const answer = yield* Fiber.join(fiber);
        return { resolved, forgot, answer };
      })
    );
    expect(result).toEqual({
      resolved: true,
      forgot: false,
      answer: { status: 'no_answer' },
    });
  });
});
