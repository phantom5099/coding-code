import { describe, it, expect } from 'vitest';
import { isTurnEnd } from '../../src/contracts/frame.js';
import type { Frame, FrameBody } from '../../src/contracts/frame.js';

const turnId = 1;

describe('isTurnEnd', () => {
  it('recognizes every end reason', () => {
    const reasons: Array<FrameBody> = [
      { family: 'transition', transition: { to: 'end', reason: 'done' } },
      { family: 'transition', transition: { to: 'end', reason: 'maxSteps' } },
      { family: 'transition', transition: { to: 'end', reason: 'aborted' } },
      {
        family: 'transition',
        transition: { to: 'end', reason: 'error', error: { message: 'boom', code: 'X' } },
      },
    ];
    for (const body of reasons) expect(isTurnEnd(body)).toBe(true);
  });

  it('rejects non-end frames', () => {
    const others: FrameBody[] = [
      { family: 'transition', transition: { to: 'start', turnId } },
      { family: 'transition', transition: { to: 'executing' } },
      { family: 'transition', transition: { to: 'compress' } },
      { family: 'event', event: { type: 'text_delta', text: 'hi' } },
      { family: 'fatal', fatal: { message: 'x', code: 'Y' } },
    ];
    for (const body of others) expect(isTurnEnd(body)).toBe(false);
  });

  it('narrows to the end transition so reason/error are readable', () => {
    const body: FrameBody = {
      family: 'transition',
      transition: { to: 'end', reason: 'error', error: { message: 'boom', code: 'LLM_FAILED' } },
    };
    if (isTurnEnd(body) && body.transition.reason === 'error') {
      expect(body.transition.error.code).toBe('LLM_FAILED');
    } else {
      throw new Error('isTurnEnd failed to narrow');
    }
  });
});

describe('Frame envelope composition', () => {
  it('is an Envelope intersected with a FrameBody', () => {
    const frame: Frame = {
      sessionId: 'sess-1',
      turnId,
      seq: 3,
      family: 'event',
      event: { type: 'text_delta', text: 'hi' },
    };
    expect(frame.sessionId).toBe('sess-1');
    expect(frame.seq).toBe(3);
    expect(frame.family).toBe('event');
  });

  it('allows a pre-start fatal frame to carry a null turnId', () => {
    const frame: Frame = {
      sessionId: 'sess-1',
      turnId: null,
      seq: 1,
      family: 'fatal',
      fatal: { message: 'transport down', code: 'TRANSPORT' },
    };
    expect(frame.turnId).toBeNull();
  });
});
