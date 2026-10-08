import { mediaKindOf, type MediaPart, type Message, type TextPart } from '../llm/types.js';
import type { StoredMediaPart } from '../session/types.js';

/**
 * 音频每秒 token 数：取各家公开值里的上界（Gemini 32 / 秒，Qwen-Audio 25 / 秒，
 * OpenAI 未公布固定值），让压缩早触发。
 */
const AUDIO_TOKENS_PER_SECOND = 32;
/** PDF 按体积折算：1MB ≈ 5 万 token。 */
const PDF_TOKENS_PER_MB = 50_000;

/**
 * 可估算的内容块：瘦块（llm 层）与落盘富块（session 层）都收。
 *
 * 元数据存在就精算，不存在就取保守回退——估算只做压缩决策，不追求精确。
 */
export type EstimablePart = TextPart | MediaPart | StoredMediaPart;

export function estimateTokensForPart(p: EstimablePart): number {
  if (p.type === 'text') return estimateTokensForContent(p.text);
  switch (mediaKindOf(p.mimeType)) {
    case 'image':
      // tile 计费近似：基准 85 + 每 512×512 tile 170
      return (
        85 +
        170 *
          Math.ceil((('width' in p ? p.width : undefined) ?? 512) / 512) *
          Math.ceil((('height' in p ? p.height : undefined) ?? 512) / 512)
      );
    case 'audio':
      return Math.ceil((('durationSec' in p ? p.durationSec : undefined) ?? 1) * AUDIO_TOKENS_PER_SECOND);
    case 'file':
      return Math.ceil((('bytes' in p ? p.bytes : 0) / (1024 * 1024)) * PDF_TOKENS_PER_MB);
  }
}

export function estimateMessageTokens(m: Message): number {
  let tokens = 0;
  for (const p of m.content) tokens += estimateTokensForPart(p);
  tokens += estimateTokensForContent(m.role);
  if (m.name) tokens += estimateTokensForContent(m.name);
  if (m.tool_call_id) tokens += estimateTokensForContent(m.tool_call_id);
  if (m.tool_name) tokens += estimateTokensForContent(m.tool_name);
  // OpenAI chat format fixed overhead per message (role tag, content key, delimiters)
  tokens += 4;
  return tokens;
}

export function estimateTokens(messages: Message[]): number {
  let total = 0;
  for (const m of messages) {
    total += estimateMessageTokens(m);
  }
  return total;
}

export function estimateTokensForContent(content: string): number {
  let charCount = 0;
  for (const char of content) {
    charCount += char.charCodeAt(0) > 127 ? 3.5 : 1;
  }
  return Math.ceil(charCount / 3.5);
}
