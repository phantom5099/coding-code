import type { Effect } from 'effect';
import type { AgentError } from '../util/error.js';

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** 文本块。 */
export interface TextPart {
  type: 'text';
  text: string;
}
/** 媒体块的引用形态：装配、估算、压缩共用的轻量形状。落盘元数据（体积 / 宽高 / 时长）归 session 层的 StoredMediaPart。 */
export interface MediaPart {
  type: 'media';
  /** 项目 assets 目录下的文件名，内容寻址、不可变 */
  asset: string;
  /** 服务端嗅探结果，不采信客户端声明；种类也由它判定 */
  mimeType: string;
  /** 客户端原始文件名，出网作 file part 的 filename；PDF 必填 */
  filename?: string;
}

/** 媒体块的出网形态：装配层已把 asset 解析成 data URL，驱动层只做序列化。 */
export interface ResolvedMediaPart {
  type: 'media';
  dataUrl: string;
  mimeType: string;
  filename?: string;
}

export type ContentPart = TextPart | MediaPart;

/** 出网内容块：媒体字节已在装配层内联。 */
export type ResolvedContentPart = TextPart | ResolvedMediaPart;

/** 入口形态：媒体携带原始字节。只出现在请求边界与 agent 入参，落盘即消失。 */
export interface IncomingMedia {
  type: 'media';
  bytes: Uint8Array;
  filename?: string;
  declaredMimeType?: string;
}

export type IncomingPart = TextPart | IncomingMedia;

/** 媒体按 mime 主类型分档：图片 / 音频 / 其它文件。全链路唯一的判定口径。 */
export type MediaKind = 'image' | 'audio' | 'file';

export function mediaKindOf(mimeType: string): MediaKind {
  const mime = (mimeType ?? '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

/** 纯文本构造的短助手，给只有文本的构造点用。 */
export const textPart = (text: string): TextPart => ({ type: 'text', text });

const MEDIA_MARKER: Record<MediaKind, string> = {
  image: '[image]',
  audio: '[audio]',
  file: '[file]',
};

/**
 * 文本投影：标题 / 压缩模板 / 记忆摘要 / token 估算共用的唯一口径。
 *
 * 落盘形态与入口形态都收：入口只在 agent 首帧定标题时用一次。
 */
export function textOf(parts: readonly (ContentPart | ResolvedContentPart | IncomingPart)[]): string {
  return parts
    .map((p) => {
      if (p.type === 'text') return p.text;
      const mime = 'mimeType' in p ? p.mimeType : (p.declaredMimeType ?? '');
      return MEDIA_MARKER[mediaKindOf(mime)];
    })
    .join('\n');
}

export interface Message {
  role: MessageRole;
  content: ContentPart[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  tool_name?: string;
  name?: string;
  usage?: TokenUsage;
}

/** 出网消息：交给驱动的完整载荷，媒体字节已由装配层内联，驱动不再需要外部解析。 */
export interface ResolvedMessage extends Omit<Message, 'content'> {
  content: ResolvedContentPart[];
}

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
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: TokenUsage;
}

/** 一次 LLM 调用的流式部件：内容与终结边界 */
export type LLMStreamPart =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'tool_call';
      readonly id: string;
      readonly name: string;
      readonly arguments: Record<string, unknown>;
    }
  | { readonly type: 'end'; readonly usage?: TokenUsage };

export interface ModelInfo {
  provider: string;
  model: string;
  maxTokens: number;
  supportsToolCalling: boolean;
  supportsStreaming: boolean;
}

export interface LLMClient {
  complete(req: LLMRequest, signal?: AbortSignal): Effect.Effect<LLMResponse, AgentError>;
  completeStream(req: LLMRequest, signal?: AbortSignal): AsyncIterable<LLMStreamPart>;
  readonly modelInfo: ModelInfo;
}
