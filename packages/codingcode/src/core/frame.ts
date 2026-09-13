import type { TodoItem, TokenUsage } from './types.js';

export type EndReason = 'done' | 'error' | 'maxSteps' | 'aborted';

export interface FrameError {
  readonly message: string;
  readonly code: string;
}

export interface ResponseMeta {
  readonly usage?: TokenUsage;
}

export interface Envelope {
  readonly sessionId: string;
  readonly turnId: number | null;
  readonly seq: number;
}

export type Transition =
  | { readonly to: 'start'; readonly turnId: number }
  | {
      readonly to: 'executing';
      readonly responded?: ResponseMeta;
    }
  | { readonly to: 'compress' }
  | { readonly to: 'end'; readonly reason: 'done' | 'maxSteps' | 'aborted' }
  | { readonly to: 'end'; readonly reason: 'error'; readonly error: FrameError };

export type ToolOutcome =
  | { readonly status: 'ok'; readonly output: string }
  | { readonly status: 'error'; readonly output: string }
  | { readonly status: 'denied'; readonly reason: string };

export type RuntimeEvent =
  | { readonly type: 'text_delta'; readonly text: string }
  | {
      readonly type: 'tool_call';
      readonly id: string;
      readonly name: string;
      readonly args: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: 'tool_result';
      readonly id: string;
      readonly name: string;
      readonly outcome: ToolOutcome;
      /** 仅当本次结果使会话 todo 变更时携带 */
      readonly todos?: readonly TodoItem[];
    }
  | {
      readonly type: 'approval_request';
      readonly id: string;
      readonly tool: string;
      readonly args: Readonly<Record<string, unknown>>;
  };

export interface Fatal {
  readonly message: string;
  readonly code: string;
}

export type FrameBody =
  | { readonly family: 'transition'; readonly transition: Transition }
  | { readonly family: 'event'; readonly event: RuntimeEvent }
  | { readonly family: 'fatal'; readonly fatal: Fatal };

export type Frame = Envelope & FrameBody;

type EndTransition = Extract<Transition, { to: 'end' }>;

export function isTurnEnd(
  body: FrameBody
): body is { readonly family: 'transition'; readonly transition: EndTransition } {
  return body.family === 'transition' && body.transition.to === 'end';
}
