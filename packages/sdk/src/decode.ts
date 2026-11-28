import type {
  ApprovalAction,
  Frame,
  FrameError,
  RuntimeEvent,
  ToolOutcome,
  Transition,
} from './protocol.js';

type WireTransitionTarget = Transition['to'];
type WireEndReason = Extract<Transition, { to: 'end' }>['reason'];
type WireEventType = RuntimeEvent['type'];
type WireOutcomeStatus = ToolOutcome['status'];

export type DecodeFailureReason =
  | 'shape'
  | 'unknown-family'
  | 'unknown-transition'
  | 'unknown-event';

export type DecodeResult =
  | { readonly ok: true; readonly frame: Frame }
  | { readonly ok: false; readonly reason: DecodeFailureReason; readonly raw: unknown };

/**
 * 帧词汇表：运行时校验用的字面量集合，逐个 `satisfies` 对齐 core 权威类型
 * （`@codingcode/sink` 的 Transition/RuntimeEvent/ToolOutcome、`@codingcode/util` 的 ApprovalAction）。
 * 拥有者改动词汇表而这里没跟上时，编译期即报错 —— 不再是运行时漂移。
 */
const TRANSITIONS = ['start', 'executing', 'compress', 'end'] as const satisfies readonly WireTransitionTarget[];
const EVENTS = [
  'reasoning_delta',
  'text_delta',
  'tool_call',
  'tool_result',
  'approval_request',
  'ask_user',
  'subagent_event',
  'user_input',
] as const satisfies readonly WireEventType[];
const END_REASONS = ['done', 'error', 'maxSteps', 'aborted'] as const satisfies readonly WireEndReason[];
const OUTCOMES = ['ok', 'error', 'denied'] as const satisfies readonly WireOutcomeStatus[];
const APPROVAL_ACTIONS = [
  'file',
  'exec',
  'network',
  'mcp',
  'subagent',
  'sandbox',
  'other',
] as const satisfies readonly ApprovalAction[];

const TRANSITION_SET = new Set<string>(TRANSITIONS);
const EVENT_SET = new Set<string>(EVENTS);
const END_REASON_SET = new Set<string>(END_REASONS);
const OUTCOME_SET = new Set<string>(OUTCOMES);
const APPROVAL_ACTION_SET = new Set<string>(APPROVAL_ACTIONS);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isError(v: unknown): v is FrameError {
  return isRecord(v) && typeof v.message === 'string' && typeof v.code === 'string';
}

function isOutcome(v: unknown): v is ToolOutcome {
  if (!isRecord(v) || typeof v.status !== 'string' || !OUTCOME_SET.has(v.status)) return false;
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
    if (!isRecord(t) || typeof t.to !== 'string' || !TRANSITION_SET.has(t.to)) {
      return { ok: false, reason: 'unknown-transition', raw };
    }
    if (t.to === 'start' && typeof t.turnId !== 'number') {
      return { ok: false, reason: 'shape', raw };
    }
    if (t.to === 'end') {
      if (typeof t.reason !== 'string' || !END_REASON_SET.has(t.reason)) {
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
    if (!isRecord(e) || typeof e.type !== 'string' || !EVENT_SET.has(e.type)) {
      return { ok: false, reason: 'unknown-event', raw };
    }
    if ((e.type === 'reasoning_delta' || e.type === 'text_delta') && typeof e.text !== 'string') {
      return { ok: false, reason: 'shape', raw };
    }
    if (
      (e.type === 'tool_call' || e.type === 'approval_request') &&
      (typeof e.id !== 'string' || !isRecord(e.arguments))
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
    if (
      e.type === 'approval_request' &&
      (typeof e.tool !== 'string' ||
        typeof e.action !== 'string' ||
        !APPROVAL_ACTION_SET.has(e.action))
    ) {
      return { ok: false, reason: 'shape', raw };
    }
    if (
      e.type === 'ask_user' &&
      (typeof e.id !== 'string' ||
        typeof e.question !== 'string' ||
        (e.questiontype !== 'single' && e.questiontype !== 'multiple' && e.questiontype !== 'text'))
    ) {
      return { ok: false, reason: 'shape', raw };
    }
    if (e.type === 'subagent_event') {
      if (
        typeof e.sessionId !== 'string' ||
        typeof e.agentName !== 'string' ||
        typeof e.status !== 'string'
      ) {
        return { ok: false, reason: 'shape', raw };
      }
    }
    if (e.type === 'user_input') {
      if (typeof e.id !== 'string' || !Array.isArray(e.parts)) {
        return { ok: false, reason: 'shape', raw };
      }
    }
    return { ok: true, frame: raw as unknown as Frame };
  }

  return { ok: false, reason: 'unknown-family', raw };
}
