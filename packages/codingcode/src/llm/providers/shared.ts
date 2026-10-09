import { jsonSchema, type LanguageModelUsage, type ModelMessage } from 'ai';
import { textOf, type ResolvedMessage, type TokenUsage } from '../types.js';

export function convertMessages(messages: ResolvedMessage[]): ModelMessage[] {
  return messages.map((m) => {
    if (m.role === 'assistant' && m.tool_calls && Array.isArray(m.tool_calls)) {
      const content: any[] = [{ type: 'text', text: textOf(m.content) }];
      for (const tc of m.tool_calls) {
        content.push({
          type: 'tool-call',
          toolCallId: (tc as any).id ?? 'unknown',
          toolName: (tc as any).name ?? 'unknown',
          input: (tc as any).arguments ?? {},
        });
      }
      return { role: 'assistant', content } as ModelMessage;
    }
    if (m.role === 'tool' && m.tool_call_id) {
      return {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: m.tool_call_id,
            toolName: (m as any).tool_name || '',
            output: { type: 'text', value: textOf(m.content) },
          },
        ],
      } as unknown as ModelMessage;
    }

    if (m.role === 'user' || m.role === 'system') {
      const parts: any[] = [];
      for (const p of m.content) {
        if (p.type === 'text') {
          parts.push({ type: 'text', text: p.text });
          continue;
        }
        // 图片、音频、PDF 一律发 file 部件：协议层 user 消息只有 text | file，
        // 驱动按 mediaType 分派到 image_url / input_audio / file
        parts.push({
          type: 'file',
          data: p.dataUrl,
          mediaType: p.mimeType,
          filename: p.filename,
        });
      }
      return { role: m.role, content: parts } as unknown as ModelMessage;
    }

    return { role: m.role as any, content: textOf(m.content) } as ModelMessage;
  });
}

export function convertTools(
  tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>
): Record<string, any> | undefined {
  if (!tools || tools.length === 0) return undefined;
  const result: Record<string, any> = {};
  for (const t of tools) {
    result[t.name] = {
      description: t.description,
      inputSchema: jsonSchema(t.parameters as any),
    };
  }
  return result;
}

/** SDK v6 的 inputTokens 已含 cached，此处不做减法：prompt 同时充当上下文占用 */
export function toTokenUsage(u: LanguageModelUsage): TokenUsage {
  return {
    prompt: u.inputTokens ?? 0,
    completion: u.outputTokens ?? 0,
    total: u.totalTokens ?? 0,
  };
}
