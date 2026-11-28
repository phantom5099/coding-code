/**
 * 帧协议层：全部从 core re-export。
 * `Envelope`/`Frame` 拥有者是 `@codingcode/http`（SSE 帧封套），
 * 其余帧体类型拥有者是 `@codingcode/sink`，`ApprovalAction` 拥有者是 `@codingcode/util`。
 */
export type {
  FrameError,
  ResponseMeta,
  Transition,
  ToolOutcome,
  RuntimeEvent,
  Fatal,
  FrameBody,
} from '@codingcode/sink';
export type { Envelope, Frame } from '@codingcode/http';
export type { ApprovalAction } from '@codingcode/util';
