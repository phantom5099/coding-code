import { describe, it, expect } from 'vitest';
import { decodeFrame } from '../src/decode.js';

const BASE = { sessionId: 's1', seq: 1, turnId: 1 };

const askEvent = (overrides: Record<string, unknown> = {}) => ({
  ...BASE,
  family: 'event',
  event: {
    type: 'ask_user',
    id: 'tc-1',
    question: '什么颜色',
    questiontype: 'single',
    options: ['红色', '蓝色'],
    ...overrides,
  },
});

describe('decodeFrame: ask_user 帧', () => {
  it('合法 single（带 options）通过且原样透传', () => {
    const raw = askEvent();
    const result = decodeFrame(raw);
    expect(result).toEqual({ ok: true, frame: raw });
  });

  it('合法 multiple 不带 options（可选字段）通过', () => {
    const raw = askEvent({ questiontype: 'multiple', options: undefined });
    const result = decodeFrame(raw);
    expect(result).toEqual({ ok: true, frame: raw });
  });

  it('合法 text（无 options）通过', () => {
    const raw = askEvent({ questiontype: 'text', options: undefined });
    expect(decodeFrame(raw)).toEqual({ ok: true, frame: raw });
  });

  it('缺 id → shape 拒绝', () => {
    const { id: _omit, ...event } = askEvent().event as Record<string, unknown>;
    const result = decodeFrame({ ...BASE, family: 'event', event });
    expect(result).toMatchObject({ ok: false, reason: 'shape' });
  });

  it('缺 question → shape 拒绝', () => {
    const { question: _omit, ...event } = askEvent().event as Record<string, unknown>;
    const result = decodeFrame({ ...BASE, family: 'event', event });
    expect(result).toMatchObject({ ok: false, reason: 'shape' });
  });

  it('非法 questiontype → shape 拒绝', () => {
    const result = decodeFrame(askEvent({ questiontype: 'checkbox' }));
    expect(result).toMatchObject({ ok: false, reason: 'shape' });
  });

  it('question 非字符串 → shape 拒绝', () => {
    const result = decodeFrame(askEvent({ question: 42 }));
    expect(result).toMatchObject({ ok: false, reason: 'shape' });
  });

  it('id 非字符串 → shape 拒绝', () => {
    const result = decodeFrame(askEvent({ id: 7 }));
    expect(result).toMatchObject({ ok: false, reason: 'shape' });
  });

  it('白名单外的事件类型 → unknown-event（ask_user 已入名单不误杀）', () => {
    const raw = { ...BASE, family: 'event', event: { type: 'not_a_real_event' } };
    expect(decodeFrame(raw)).toMatchObject({ ok: false, reason: 'unknown-event' });
    expect(decodeFrame(askEvent()).ok).toBe(true);
  });

  it('外层帧字段缺失（sessionId/seq）→ shape 拒绝', () => {
    const { event } = askEvent();
    expect(decodeFrame({ seq: 1, turnId: 1, family: 'event', event })).toMatchObject({
      ok: false,
      reason: 'shape',
    });
    expect(decodeFrame({ sessionId: 's1', turnId: 1, family: 'event', event })).toMatchObject({
      ok: false,
      reason: 'shape',
    });
  });
});
