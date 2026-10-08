import { describe, it, expect } from 'vitest';
import { createFrameAssembler } from '../../src/server/frame-io.js';
import type { FrameBody } from '../../src/sink/types.js';

// ---- body builders ----

const start = (turnId: number): FrameBody => ({
  family: 'transition',
  transition: { to: 'start', turnId },
});
const enterExecuting = (): FrameBody => ({ family: 'transition', transition: { to: 'executing' } });
const fatal = (): FrameBody => ({ family: 'fatal', fatal: { message: 'x', code: 'Y' } });
const text = (t = 'hi'): FrameBody => ({ family: 'event', event: { type: 'text_delta', text: t } });

// ---- envelope ----

describe('createFrameAssembler — envelope', () => {
  it('stamps sessionId, a monotonically increasing seq and the current turnId', () => {
    const a = createFrameAssembler({ sessionId: 'sess-1' });
    const f1 = a.stamp(start(7));
    const f2 = a.stamp(enterExecuting());
    const f3 = a.stamp(text());

    expect(f1).toMatchObject({ sessionId: 'sess-1', turnId: 7, seq: 1 });
    expect(f2).toMatchObject({ sessionId: 'sess-1', turnId: 7, seq: 2 });
    expect(f3).toMatchObject({ sessionId: 'sess-1', turnId: 7, seq: 3 });
  });

  it('keeps turnId null for frames emitted before start', () => {
    const a = createFrameAssembler({ sessionId: 's' });
    expect(a.stamp(fatal())).toMatchObject({ turnId: null, seq: 1, family: 'fatal' });
  });

  it('stamps unconditionally — the assembler enforces no ordering', () => {
    const a = createFrameAssembler({ sessionId: 's' });
    expect(a.stamp(text())).toMatchObject({ seq: 1, family: 'event' });
    expect(a.stamp(start(2))).toMatchObject({ seq: 2, turnId: 2 });
  });
});
