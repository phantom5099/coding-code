import { generateText, streamText, stepCountIs, jsonSchema } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { ModelMessage } from '@ai-sdk/provider-utils';
import { Result } from '../../core/result';
import { AgentError } from '../../core/error';
import type { LLMClient } from '../client';
import type { LLMRequest, LLMResponse } from '../types';
import type { SelectableModel } from '../factory';

function convertMessages(messages: Array<{ role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }>): ModelMessage[] {
  return messages.map((m) => {
    if (m.role === 'assistant' && m.tool_calls && Array.isArray(m.tool_calls)) {
      const content: any[] = [{ type: 'text', text: m.content }];
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
        content: [{
          type: 'tool-result',
          toolCallId: m.tool_call_id,
          toolName: (m as any).tool_name || '',
          output: { type: 'text', value: m.content },
        }],
      } as unknown as ModelMessage;
    }
    return { role: m.role as any, content: m.content } as ModelMessage;
  });
}

function convertTools(tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>): Record<string, any> | undefined {
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

function parseResponseMessages(responseMessages: ModelMessage[]): LLMResponse {
  const lastAssistant = [...responseMessages].reverse().find((m) => m.role === 'assistant');
  if (!lastAssistant) {
    return { content: '', finishReason: 'stop' };
  }

  let content = '';
  const toolCalls: LLMResponse['toolCalls'] = [];

  if (typeof lastAssistant.content === 'string') {
    content = lastAssistant.content;
  } else if (Array.isArray(lastAssistant.content)) {
    for (const part of lastAssistant.content as any[]) {
      if (part.type === 'text') content += part.text ?? '';
      if (part.type === 'tool-call') {
        toolCalls.push({
          id: part.toolCallId ?? 'unknown',
          name: part.toolName ?? 'unknown',
          arguments: part.input ?? {},
        });
      }
    }
  }

  return {
    content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
  };
}

export class DeepSeekProvider implements LLMClient {
  constructor(
    private model: LanguageModelV3,
    private entry: SelectableModel,
  ) {}

  get modelInfo() {
    return {
      provider: this.entry.provider,
      model: this.entry.model,
      maxTokens: 64_000,
      supportsToolCalling: true,
      supportsStreaming: true,
    };
  }

  async complete(req: LLMRequest, signal?: AbortSignal): Promise<Result<LLMResponse, AgentError>> {
    try {
      const result = await generateText({
        model: this.model,
        system: req.system,
        messages: convertMessages(req.messages),
        tools: convertTools(req.tools),
        stopWhen: req.maxSteps ? stepCountIs(req.maxSteps) : undefined,
        abortSignal: signal,
      });

      const response = parseResponseMessages(result.response.messages as ModelMessage[]);
      if (result.usage) {
        const usage = result.usage as any;
        response.usage = {
          prompt: usage.promptTokens ?? 0,
          completion: usage.completionTokens ?? 0,
          total: usage.totalTokens ?? 0,
        };
      }
      return Result.ok(response);
    } catch (e) {
      return Result.err(AgentError.llmFailed(e));
    }
  }

  completeStream(req: LLMRequest, signal?: AbortSignal): import('../client').StreamResult {
    const result = streamText({
      model: this.model,
      system: req.system,
      messages: convertMessages(req.messages),
      tools: convertTools(req.tools),
      stopWhen: req.maxSteps ? stepCountIs(req.maxSteps) : undefined,
      abortSignal: signal,
    });

    const stream = async function* () {
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          yield part.text;
        } else if (part.type === 'tool-call') {
          yield `\n[Using: ${part.toolName}]\n`;
        } else if (part.type === 'error') {
          yield `\n[Error: ${String(part.error)}]\n`;
        }
      }
    }();

    const response = (async () => {
      try {
        const resp = await result.response;
        const parsed = parseResponseMessages(resp.messages as ModelMessage[]);
        return Result.ok(parsed);
      } catch (e) {
        return Result.err(AgentError.llmFailed(e));
      }
    })();

    return { stream, response };
  }
}
