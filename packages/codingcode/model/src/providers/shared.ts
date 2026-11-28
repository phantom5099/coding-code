import {
  jsonSchema,
  type AssistantContent,
  type LanguageModelUsage,
  type ModelMessage,
  type ToolSet,
  type UserContent,
} from 'ai';
import { textOf, type ResolvedMessage, type TokenUsage, type ToolDescription } from '../types.js';

export function convertMessages(messages: ResolvedMessage[]): ModelMessage[] {
  return messages.map((m): ModelMessage => {
    switch (m.role) {
      case 'assistant': {
        const content: Exclude<AssistantContent, string> = [];
        if (m.reasoning?.displayText) {
          content.push({
            type: 'reasoning',
            text: m.reasoning.replayData?.value ?? m.reasoning.displayText,
          });
        }
        content.push({ type: 'text', text: textOf(m.content) });
        if (m.tool_calls && Array.isArray(m.tool_calls)) {
          for (const tc of m.tool_calls) {
            content.push({
              type: 'tool-call',
              toolCallId: tc.id ?? 'unknown',
              toolName: tc.name ?? 'unknown',
              input: tc.arguments ?? {},
            });
          }
        }
        return { role: 'assistant', content };
      }
      case 'tool':
        if (m.tool_call_id) {
          return {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: m.tool_call_id,
                toolName: m.tool_name || '',
                output: { type: 'text', value: textOf(m.content) },
              },
            ],
          };
        }
        return { role: 'user', content: textOf(m.content) };
      case 'system':
        return { role: 'system', content: textOf(m.content) };
      case 'user': {
        const parts: Exclude<UserContent, string> = [];
        for (const p of m.content) {
          if (p.type === 'text') {
            parts.push({ type: 'text', text: p.text });
            continue;
          }
          parts.push({
            type: 'file',
            data: p.dataUrl,
            mediaType: p.mimeType,
            filename: p.filename,
          });
        }
        return { role: 'user', content: parts };
      }
    }
  });
}

export function convertTools(tools?: readonly ToolDescription[]): ToolSet | undefined {
  if (!tools || tools.length === 0) return undefined;
  const result: ToolSet = {};
  for (const t of tools) {
    result[t.name] = {
      description: t.description,
      inputSchema: jsonSchema(t.parameters),
    };
  }
  return result;
}

/** SDK v6 的 inputTokens 已含 cached，此处不做减法：prompt 同时充当上下文占用 */
export function toTokenUsage(u: LanguageModelUsage): TokenUsage {
  const reasoningTokens = u.outputTokenDetails?.reasoningTokens ?? u.reasoningTokens;
  return {
    prompt: u.inputTokens ?? 0,
    completion: u.outputTokens ?? 0,
    total: u.totalTokens ?? 0,
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
  };
}
