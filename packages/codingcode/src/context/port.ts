import { Context } from 'effect';
import type { Message } from '../core/types.js';
import type { LLMClient } from '../llm/client.js';

export interface BuildResult {
  messages: Message[];
  /** 本次组装是否发生过 LLM 摘要压缩（决策在 context 内部，仅上报结果） */
  compressed: boolean;
  /** 摘要压缩释放的 token 数（未压缩为 0） */
  released: number;
  /** 组装后上下文估算 token 数 */
  promptEstimate: number;
}

export interface CompressResult {
  didCompress: boolean;
  released: number;
  promptEstimate: number;
}

export interface ContextShape {
  assemblePayload(transcriptPath: string, contextWindow: number, llm: LLMClient | null): Promise<BuildResult>;
  compactWithLLM(transcriptPath: string, modelMaxTokens: number, llm: LLMClient | null, usage?: number): Promise<CompressResult>;
}

export class ContextService extends Context.Tag('Context')<ContextService, ContextShape>() {}
