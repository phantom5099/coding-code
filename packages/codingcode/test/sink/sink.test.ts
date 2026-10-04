import { describe, it, expect } from 'vitest';
import { Effect, Queue } from 'effect';
import { EventSinkService } from '../../src/sink/port.js';
import { EventSinkLayer } from '../../src/sink/sink.js';
import type { FrameBody } from '../../src/contracts/frame.js';

const run = <A, E>(eff: Effect.Effect<A, E, EventSinkService>): Promise<A> =>
  Effect.runPromise(eff.pipe(Effect.provide(EventSinkLayer)));

const textDelta = (t: string): FrameBody => ({ family: 'event', event: { type: 'text_delta', text: t } });
const toolCall = (id: string): FrameBody => ({
  family: 'event',
  event: { type: 'tool_call', id, name: 'read_file', args: {} },
});

function takeN(q: Queue.Queue<FrameBody>, n: number): Effect.Effect<FrameBody[]> {
  return Effect.gen(function* () {
    const out: FrameBody[] = [];
    for (let i = 0; i < n; i++) out.push(yield* Queue.take(q));
    return out;
  });
}

describe('EventSink', () => {
  it('attach 覆盖式：旧队列被替换，emit 只进新队列', async () => {
    const result = await run(
      Effect.gen(function* () {
        const sink = yield* EventSinkService;
        const first = yield* sink.attach('s1');
        const second = yield* sink.attach('s1');

        yield* sink.emit('s1', textDelta('a'));

        const fromSecond = yield* Queue.poll(second);
        const fromFirst = yield* Queue.poll(first);
        return { fromSecond, fromFirst };
      })
    );

    expect(result.fromSecond._tag).toBe('Some');
    expect(result.fromFirst._tag).toBe('None');
  });

  it('detach 后 emit 静默丢弃（不抛错，旧队列收不到）', async () => {
    const result = await run(
      Effect.gen(function* () {
        const sink = yield* EventSinkService;
        const q = yield* sink.attach('s2');
        yield* sink.detach('s2');
        yield* sink.emit('s2', textDelta('dropped'));
        return yield* Queue.poll(q);
      })
    );

    expect(result._tag).toBe('None');
  });

  it('未挂载的会话 emit 是静默丢弃', async () => {
    await expect(run(Effect.gen(function* () {
      const sink = yield* EventSinkService;
      yield* sink.emit('never-attached', textDelta('x'));
    }))).resolves.toBeUndefined();
  });

  it('同一队列内先入先出：投递顺序 == 取出顺序', async () => {
    const frames = await run(
      Effect.gen(function* () {
        const sink = yield* EventSinkService;
        const q = yield* sink.attach('s3');
        yield* sink.emit('s3', textDelta('first'));
        yield* sink.emit('s3', toolCall('t1'));
        yield* sink.emit('s3', textDelta('third'));
        return yield* takeN(q, 3);
      })
    );

    expect(frames.map((f) => (f.family === 'event' ? f.event.type : f.family))).toEqual([
      'text_delta',
      'tool_call',
      'text_delta',
    ]);
  });
});
