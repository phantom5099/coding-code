import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { MailboxLayer, MailboxService } from '../../src/session/mailbox.js';

const item = (sessionId: string, content = 'x') => ({
  type: 'subagent_result' as const,
  sessionId,
  agentName: 'build',
  content,
});

const run = <T>(eff: Effect.Effect<T, any, any>): Promise<T> =>
  Effect.runPromise(
    eff.pipe(Effect.provide(MailboxLayer)) as unknown as Effect.Effect<T, never, never>
  );

describe('session mailbox', () => {
  it('offer / drain：取走当前全部，再 drain 为空', async () => {
    const result = await run(
      Effect.gen(function* () {
        const mb = yield* MailboxService;
        yield* mb.offer('s1', item('child-1', 'a'));
        yield* mb.offer('s1', item('child-2', 'b'));
        return { first: yield* mb.drain('s1'), second: yield* mb.drain('s1') };
      })
    );
    expect(result.first.map((i) => i.content)).toEqual(['a', 'b']);
    expect(result.second).toEqual([]);
  });

  it('按收件人分区：两个会话互不可见', async () => {
    const result = await run(
      Effect.gen(function* () {
        const mb = yield* MailboxService;
        yield* mb.offer('s1', item('child-1'));
        return { s2: yield* mb.drain('s2'), s1: yield* mb.drain('s1') };
      })
    );
    expect(result.s2).toEqual([]);
    expect(result.s1).toHaveLength(1);
  });

  it('dispose 只清该会话，其它会话不受影响', async () => {
    const result = await run(
      Effect.gen(function* () {
        const mb = yield* MailboxService;
        yield* mb.offer('s1', item('child-1'));
        yield* mb.offer('s2', item('child-2'));
        yield* mb.dispose('s1');
        return { s1: yield* mb.drain('s1'), s2: yield* mb.drain('s2') };
      })
    );
    expect(result.s1).toEqual([]);
    expect(result.s2).toHaveLength(1);
  });

  it('drain 一个从未投递过的会话返回空数组而不报错', async () => {
    const result = await run(
      Effect.gen(function* () {
        const mb = yield* MailboxService;
        return yield* mb.drain('never-used');
      })
    );
    expect(result).toEqual([]);
  });
});
