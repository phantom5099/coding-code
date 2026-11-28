import type { Effect } from 'effect';
import type { AgentError, TextPart } from '@codingcode/util';
export { mediaKindOf, textOf, textPart, type MediaKind, type TextPart } from '@codingcode/util';

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
  reasoningTokens?: number;
}

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** 媒体块的引用形态：装配、估算、压缩共用的轻量形状。落盘元数据归 session 的 StoredMediaPart */
export interface MediaPart {
  type: 'media';
  /** 项目 assets 目录下的文件名，内容寻址、不可变 */
  asset: string;
  /** 服务端嗅探结果，不采信客户端声明；种类也由它判定 */
  mimeType: string;
  /** 客户端原始文件名，出网作 file part 的 filename；PDF 必填 */
  filename?: string;
}

/** 媒体块的出网形态：装配层已把 asset 解析成 data URL，驱动层只做序列化 */
export interface ResolvedMediaPart {
  type: 'media';
  dataUrl: string;
  mimeType: string;
  filename?: string;
}

export type ContentPart = TextPart | MediaPart;

/** 出网内容块：媒体字节已在装配层内联 */
export type ResolvedContentPart = TextPart | ResolvedMediaPart;

/** 入口形态：媒体携带原始字节。只出现在请求边界与 agent 入参，落盘即消失 */
export interface IncomingMedia {
  type: 'media';
  bytes: Uint8Array;
  filename?: string;
  declaredMimeType?: string;
}

export type IncomingPart = TextPart | IncomingMedia;

export type SystemMessage<P = ContentPart> = {
  role: 'system';
  content: P[];
  name?: string;
};

export type UserMessage<P = ContentPart> = {
  role: 'user';
  content: P[];
  name?: string;
};

export type AssistantMessage<P = ContentPart> = {
  role: 'assistant';
  content: P[];
  reasoning?: ReasoningData;
  tool_calls?: ToolCall[];
  name?: string;
  usage?: TokenUsage;
};

export type ToolMessage<P = ContentPart> = {
  role: 'tool';
  content: P[];
  tool_call_id?: string;
  tool_name?: string;
  name?: string;
};

export type Message =
  | SystemMessage<ContentPart>
  | UserMessage<ContentPart>
  | AssistantMessage<ContentPart>
  | ToolMessage<ContentPart>;

/** 出网消息：交给驱动的完整载荷，媒体字节已由装配层内联，驱动不再需要外部解析。 */
export type ResolvedMessage =
  | SystemMessage<ResolvedContentPart>
  | UserMessage<ResolvedContentPart>
  | AssistantMessage<ResolvedContentPart>
  | ToolMessage<ResolvedContentPart>;

/** 请求里"给模型看的"工具描述。 */
export interface ToolDescription {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMRequest {
  messages: ResolvedMessage[];
  system?: string;
  tools?: ToolDescription[];
  maxSteps?: number;
  temperature?: number;
  reasoning?: ReasoningOptions;
  signal?: AbortSignal;
}

/** 面向 LLMService 的完整调用指令（含模型标识与取消信号） */
export interface LLMInvocation extends LLMRequest {
  model: string;
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  reasoning?: ReasoningData;
  usage?: TokenUsage;
}

export type ReasoningMode = 'auto' | 'enabled' | 'disabled';

export interface ReasoningOptions {
  mode?: ReasoningMode;
  level?: string;
}

export type ReasoningReplayData = { kind: 'full_text'; value: string };

export interface ReasoningData {
  displayText: string;
  provider: string;
  replayData?: ReasoningReplayData;
  reasoningTokens?: number;
}

/** 一次 LLM 调用的流式部件：内容与终结边界 */
export type LLMStreamPart =
  | {
      readonly type: 'reasoning';
      readonly text: string;
      readonly provider: string;
    }
  | { readonly type: 'text'; readonly text: string }
  | ({ readonly type: 'tool_call' } & Readonly<ToolCall>)
  | { readonly type: 'end'; readonly usage?: TokenUsage };

export interface ModelInfo {
  provider: string;
  model: string;
  maxTokens: number;
  supportsToolCalling: boolean;
  supportsStreaming: boolean;
}

export interface LLMClient {
  complete(req: LLMRequest): Effect.Effect<LLMResponse, AgentError>;
  completeStream(req: LLMRequest): AsyncIterable<LLMStreamPart>;
  readonly modelInfo: ModelInfo;
}
