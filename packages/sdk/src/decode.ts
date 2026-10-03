import type { EndReason, Frame, FrameError, ToolOutcome } from './protocol.js';

export type DecodeFailureReason =
  | 'shape'
  | 'unknown-family'
  | 'unknown-transition'
  | 'unknown-event';

export type DecodeResult =
  | { readonly ok: true; readonly frame: Frame }
  | { readonly ok: false; readonly reason: DecodeFailureReason; readonly raw: unknown };

const TRANSITIONS = new Set(['start', 'executing', 'compress', 'end']);
const EVENTS = new Set(['text_delta', 'tool_call', 'tool_result', 'approval_request']);
const END_REASONS = new Set<EndReason>(['done', 'error', 'maxSteps', 'aborted']);
const OUTCOMES = new Set(['ok', 'error', 'denied']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isError(v: unknown): v is FrameError {
  return isRecord(v) && typeof v.message === 'string' && typeof v.code === 'string';
}

function isOutcome(v: unknown): v is ToolOutcome {
  if (!isRecord(v) || typeof v.status !== 'string' || !OUTCOMES.has(v.status)) return false;
  if (v.status === 'denied') return typeof v.reason === 'string';
  return typeof v.output === 'string';
}

/** 校验服务端下发的帧；形状不符时返回 reason，由调用方决定丢弃还是中止。 */
export function decodeFrame(raw: unknown): DecodeResult {
  if (!isRecord(raw)) return { ok: false, reason: 'shape', raw };
  if (typeof raw.sessionId !== 'string' || typeof raw.seq !== 'number') {
    return { ok: false, reason: 'shape', raw };
  }
  const turnId = raw.turnId;
  if (turnId !== null && typeof turnId !== 'number') {
    return { ok: false, reason: 'shape', raw };
  }

  const family = raw.family;
  if (family === 'fatal') {
    if (!isError(raw.fatal)) return { ok: false, reason: 'shape', raw };
    return { ok: true, frame: raw as unknown as Frame };
  }

  if (family === 'transition') {
    const t = raw.transition;
    if (!isRecord(t) || typeof t.to !== 'string' || !TRANSITIONS.has(t.to)) {
      return { ok: false, reason: 'unknown-transition', raw };
    }
    if (t.to === 'start' && typeof t.turnId !== 'number') {
      return { ok: false, reason: 'shape', raw };
    }
    if (t.to === 'end') {
      if (typeof t.reason !== 'string' || !END_REASONS.has(t.reason as EndReason)) {
        return { ok: false, reason: 'shape', raw };
      }
      if (t.reason === 'error' && !isError(t.error)) {
        return { ok: false, reason: 'shape', raw };
      }
    }
    if (t.to === 'executing') {
      if (t.responded !== undefined && !isRecord(t.responded)) {
        return { ok: false, reason: 'shape', raw };
      }
    }
    return { ok: true, frame: raw as unknown as Frame };
  }

  if (family === 'event') {
    const e = raw.event;
    if (!isRecord(e) || typeof e.type !== 'string' || !EVENTS.has(e.type)) {
      return { ok: false, reason: 'unknown-event', raw };
    }
    if (e.type === 'text_delta' && typeof e.text !== 'string') {
      return { ok: false, reason: 'shape', raw };
    }
    if (
      (e.type === 'tool_call' || e.type === 'approval_request') &&
      (typeof e.id !== 'string' || !isRecord(e.args))
    ) {
      return { ok: false, reason: 'shape', raw };
    }
    if (e.type === 'tool_call' && typeof e.name !== 'string') {
      return { ok: false, reason: 'shape', raw };
    }
    if (e.type === 'tool_result') {
      if (typeof e.id !== 'string' || typeof e.name !== 'string' || !isOutcome(e.outcome)) {
        return { ok: false, reason: 'shape', raw };
      }
    }
    if (e.type === 'approval_request' && typeof e.tool !== 'string') {
      return { ok: false, reason: 'shape', raw };
    }
    return { ok: true, frame: raw as unknown as Frame };
  }

  return { ok: false, reason: 'unknown-family', raw };
}
