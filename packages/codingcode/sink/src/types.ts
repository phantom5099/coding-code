import type { TodoItem } from '@codingcode/todo';
import type { TokenUsage } from '@codingcode/model';
import type { StoredPart } from '@codingcode/session';
import type { ApprovalAction, ErrorCode } from '@codingcode/util';

export type FrameErrorCode = ErrorCode | (string & {});

export interface FrameError {
  readonly message: string;
  readonly code: FrameErrorCode;
}

export type Fatal = FrameError;

export interface ResponseMeta {
  readonly usage?: TokenUsage;
}

export type EndOutcome =
  | { readonly reason: 'done' | 'maxSteps' | 'aborted' }
  | { readonly reason: 'error'; readonly error: FrameError };

export type EndTransition = { readonly to: 'end' } & EndOutcome;

export type Transition =
  | { readonly to: 'start'; readonly turnId: number }
  | { readonly to: 'executing'; readonly responded?: ResponseMeta }
  | { readonly to: 'compress' }
  | EndTransition;

export type ToolOutcome =
  | { readonly status: 'ok'; readonly output: string }
  | { readonly status: 'error'; readonly output: string }
  | { readonly status: 'denied'; readonly reason: string };

export type AskQuestionType = 'single' | 'multiple' | 'text';
export type SubagentLifecycleStatus = 'spawned' | 'completed' | 'failed';

export type RuntimeEvent =
  | { readonly type: 'reasoning_delta'; readonly text: string }
  | { readonly type: 'text_delta'; readonly text: string }
  | {
      readonly type: 'tool_call';
      readonly id: string;
      readonly name: string;
      readonly arguments: Readonly<Record<string, unknown>>;
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
      readonly action: ApprovalAction;
      readonly arguments: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: 'ask_user';
      readonly id: string;
      readonly question: string;
      readonly questiontype: AskQuestionType;
      readonly options?: readonly string[];
    }
  | {
      readonly type: 'subagent_event';
      readonly sessionId: string;
      readonly agentName: string;
      readonly status: SubagentLifecycleStatus;
    }
  | {
      readonly type: 'user_input';
      readonly id: string;
      readonly parts: readonly StoredPart[];
    };

export type FrameBody =
  | { readonly family: 'transition'; readonly transition: Transition }
  | { readonly family: 'event'; readonly event: RuntimeEvent }
  | { readonly family: 'fatal'; readonly fatal: FrameError };

export function isTurnEnd(
  body: FrameBody
): body is { readonly family: 'transition'; readonly transition: EndTransition } {
  return body.family === 'transition' && body.transition.to === 'end';
}
