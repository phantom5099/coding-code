import { generateText, streamText, stepCountIs } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { Effect } from 'effect';
import type { AgentError } from '../../util/error.js';
import { mapLlmError } from '../errors.js';
import type { LLMClient, LLMRequest, LLMResponse, LLMStreamPart } from '../types.js';
import type { SelectableModel } from '../../infra/models.js';

import { convertMessages, convertTools, toTokenUsage } from './shared.js';

function reasoningOptions(req: LLMRequest, entry: SelectableModel): Record<string, any> | undefined {
  const capability = entry.capabilities.reasoning;
  if (entry.provider !== 'openai' || !capability?.supported) return undefined;
  const level = req.reasoning?.level ?? capability.defaultLevel;
  const options: Record<string, unknown> = {};
  if (level) options.reasoningEffort = level;
  if (entry.protocol === 'openai-responses') options.reasoningSummary = 'auto';
  return Object.keys(options).length > 0 ? { openai: options } : undefined;
}

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
          providerOptions: reasoningOptions(req, this.entry),
          stopWhen: req.maxSteps ? stepCountIs(req.maxSteps) : undefined,
          abortSignal: signal,
        });

        return {
          content: result.text,
          reasoning:
            typeof result.reasoning === 'string' && result.reasoning
              ? {
                  displayText: result.reasoning,
                  provider: this.entry.provider,
                  replayData: { kind: 'full_text', value: result.reasoning },
                }
              : undefined,
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
    const providerName = this.entry.provider;
    if (this.entry.provider === 'sansen' && req.tools && req.tools.length > 0) {
      const complete = this.complete(req, signal);
      return (async function* () {
        const either = await Effect.runPromise(Effect.either(complete));
        if (either._tag === 'Left') throw either.left;
        const value = either.right;
        if (value.content) yield { type: 'text', text: value.content };
        for (const tc of value.toolCalls ?? []) {
          yield { type: 'tool_call', id: tc.id, name: tc.name, arguments: tc.arguments };
        }
        yield value.usage ? { type: 'end', usage: value.usage } : { type: 'end' };
      })();
    }

    const result = streamText({
      model: this.model,
      system: req.system,
      messages: convertMessages(req.messages),
      tools: convertTools(req.tools),
      providerOptions: reasoningOptions(req, this.entry),
      stopWhen: req.maxSteps ? stepCountIs(req.maxSteps) : undefined,
      abortSignal: signal,
    });

    return (async function* () {
      for await (const part of result.fullStream) {
        switch (part.type) {
          case 'reasoning-delta':
            yield { type: 'reasoning', text: part.text, provider: providerName };
            break;
          case 'text-delta':
            yield { type: 'text', text: part.text };
            break;
          case 'tool-call':
            yield {
              type: 'tool_call',
              id: part.toolCallId,
              name: part.toolName,
              arguments: (part.input ?? {}) as Record<string, unknown>,
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
