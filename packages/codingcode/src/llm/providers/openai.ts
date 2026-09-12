import { generateText, streamText, stepCountIs } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { Effect } from 'effect';
import type { AgentError } from '../../core/error.js';
import { mapLlmError } from '../errors.js';
import type { LLMClient } from '../client.js';
import type { LLMRequest, LLMResponse, LLMStreamPart } from '../types.js';
import type { SelectableModel } from '../port.js';
import { convertMessages, convertTools, toTokenUsage } from './shared.js';

export class OpenAIProvider implements LLMClient {
  constructor(
    private model: LanguageModelV3,
    private entry: SelectableModel
  ) {}

  get modelInfo() {
    return {
      provider: this.entry.provider,
      model: this.entry.model,
      maxTokens: this.entry.context_window,
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

        return {
          content: result.text,
          toolCalls:
            result.toolCalls.length > 0
              ? result.toolCalls.map((tc) => ({
                  id: tc.toolCallId,
                  name: tc.toolName,
                  arguments: (tc.input ?? {}) as Record<string, unknown>,
                }))
              : undefined,
          usage: toTokenUsage(result.usage),
        };
      },
      catch: (e) => mapLlmError('openai', e),
    });
  }

  completeStream(req: LLMRequest, signal?: AbortSignal): AsyncIterable<LLMStreamPart> {
    // sansen 不支持流式工具调用：退回非流式，再拆成同样三种部件
    if (this.entry.provider === 'sansen' && req.tools && req.tools.length > 0) {
      const complete = this.complete(req, signal);
      return (async function* () {
        const either = await Effect.runPromise(Effect.either(complete));
        if (either._tag === 'Left') throw either.left;
        const value = either.right;
        if (value.content) yield { type: 'text', text: value.content };
        for (const tc of value.toolCalls ?? []) {
          yield { type: 'tool_call', id: tc.id, name: tc.name, args: tc.arguments };
        }
        yield value.usage ? { type: 'end', usage: value.usage } : { type: 'end' };
      })();
    }

    const result = streamText({
      model: this.model,
      system: req.system,
      messages: convertMessages(req.messages),
      tools: convertTools(req.tools),
      stopWhen: req.maxSteps ? stepCountIs(req.maxSteps) : undefined,
      abortSignal: signal,
    });

    return (async function* () {
      for await (const part of result.fullStream) {
        switch (part.type) {
          case 'text-delta':
            yield { type: 'text', text: part.text };
            break;
          case 'tool-call':
            yield {
              type: 'tool_call',
              id: part.toolCallId,
              name: part.toolName,
              args: (part.input ?? {}) as Record<string, unknown>,
            };
            break;
          case 'finish':
            yield { type: 'end', usage: toTokenUsage(part.totalUsage) };
            break;
          case 'error':
            throw mapLlmError('openai', part.error);
        }
      }
    })();
  }
}
