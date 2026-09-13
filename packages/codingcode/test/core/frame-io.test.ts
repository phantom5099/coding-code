import { describe, it, expect } from 'vitest';
import { createFrameAssembler, decodeFrame, encodeFrame } from '../../src/core/frame-io.js';
import type { FrameBody } from '../../src/core/frame.js';

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

// ---- codec ----

describe('frame codec', () => {
  it('round-trips an assembled frame through encode/decode', () => {
    const f = createFrameAssembler({ sessionId: 's' });
    const stamped = f.stamp(start(3));
    const decoded = decodeFrame(JSON.parse(encodeFrame(stamped)));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.frame).toEqual(stamped);
  });

  it('rejects a non-object payload', () => {
    expect(decodeFrame('nope')).toMatchObject({ ok: false, reason: 'shape' });
  });

  it('rejects a payload missing envelope fields', () => {
    expect(decodeFrame({ family: 'event' })).toMatchObject({ ok: false, reason: 'shape' });
  });

  it('rejects a non-numeric, non-null turnId', () => {
    expect(
      decodeFrame({ sessionId: 's', turnId: 'x', seq: 1, family: 'fatal', fatal: { message: 'm', code: 'c' } })
    ).toMatchObject({ ok: false, reason: 'shape' });
  });

  it('rejects an unknown family', () => {
    expect(decodeFrame({ sessionId: 's', turnId: null, seq: 1, family: 'nope' })).toMatchObject({
      ok: false,
      reason: 'unknown-family',
    });
  });

  it('rejects an unknown transition target', () => {
    expect(
      decodeFrame({ sessionId: 's', turnId: 1, seq: 1, family: 'transition', transition: { to: 'zzz' } })
    ).toMatchObject({ ok: false, reason: 'unknown-transition' });
  });

  it('accepts a compress frame', () => {
    const decoded = decodeFrame({
      sessionId: 's',
      turnId: 1,
      seq: 1,
      family: 'transition',
      transition: { to: 'compress' },
    });
    expect(decoded.ok).toBe(true);
  });

  it('rejects an unknown event type', () => {
    expect(
      decodeFrame({ sessionId: 's', turnId: 1, seq: 1, family: 'event', event: { type: 'zzz' } })
    ).toMatchObject({ ok: false, reason: 'unknown-event' });
  });

  it('rejects an end(error) frame without a well-formed error', () => {
    expect(
      decodeFrame({
        sessionId: 's',
        turnId: 1,
        seq: 1,
        family: 'transition',
        transition: { to: 'end', reason: 'error' },
      })
    ).toMatchObject({ ok: false, reason: 'shape' });
  });

  it('rejects a tool_result with a malformed outcome', () => {
    expect(
      decodeFrame({
        sessionId: 's',
        turnId: 1,
        seq: 1,
        family: 'event',
        event: { type: 'tool_result', id: 't1', name: 'bash', outcome: { status: 'ok' } },
      })
    ).toMatchObject({ ok: false, reason: 'shape' });
  });

  it('accepts a denied outcome carrying a reason', () => {
    const decoded = decodeFrame({
      sessionId: 's',
      turnId: 1,
      seq: 1,
      family: 'event',
      event: { type: 'tool_result', id: 't1', name: 'bash', outcome: { status: 'denied', reason: 'no' } },
    });
    expect(decoded.ok).toBe(true);
  });
});
