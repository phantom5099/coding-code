import { generateText, streamText, stepCountIs, type ModelMessage } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { Effect } from 'effect';
import { AgentError } from '../../core/error.js';
import { mapLlmError } from '../errors.js';
import type { LLMClient } from '../client.js';
import type { LLMRequest, LLMResponse } from '../types.js';
import type { SelectableModel } from '../factory.js';
import { convertMessages, convertTools, parseResponseMessages } from './shared.js';

export class DeepSeekProvider implements LLMClient {
  constructor(
    private model: LanguageModelV3,
    private entry: SelectableModel
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

  complete(req: LLMRequest, signal?: AbortSignal): Effect.Effect<LLMResponse, AgentError> {
    return Effect.tryPromise({
      try: async () => {
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
        return response;
      },
      catch: (e) => mapLlmError('deepseek', e),
    });
  }

  completeStream(req: LLMRequest, signal?: AbortSignal): import('../client.js').StreamResult {
    const result = streamText({
      model: this.model,
      system: req.system,
      messages: convertMessages(req.messages),
      tools: convertTools(req.tools),
      stopWhen: req.maxSteps ? stepCountIs(req.maxSteps) : undefined,
      abortSignal: signal,
    });

    const stream = (async function* () {
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          yield part.text;
        }
      }
    })();

    const response = (async () => {
      try {
        const resp = await result.response;
        const parsed = parseResponseMessages(resp.messages as ModelMessage[]);
        if ((resp as any).usage) {
          const usage = (resp as any).usage as any;
          parsed.usage = {
            prompt: usage.promptTokens ?? 0,
            completion: usage.completionTokens ?? 0,
            total: usage.totalTokens ?? 0,
          };
        }
        return { ok: true as const, value: parsed };
      } catch (e) {
        return { ok: false as const, error: mapLlmError('deepseek', e) };
      }
    })();

    return { stream, response };
  }
}
