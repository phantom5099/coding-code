import { Effect, Layer } from 'effect';
import { AgentError } from '@codingcode/util';
import type { LLMClient, LLMInvocation, LLMResponse, LLMStreamPart } from './types.js';
import { OpenAIProvider } from './providers/openai.js';
import { DeepSeekProvider } from './providers/deepseek.js';
import { resolveModelEntry, type SelectableModel } from './catalog.js';
import { LLMService } from './port.js';

function entryFor(model: string): Effect.Effect<SelectableModel, AgentError> {
  return Effect.try({
    try: () => resolveModelEntry(model),
    catch: (e) => (e instanceof AgentError ? e : new AgentError('CONFIG_INVALID', String(e))),
  });
}

function clientFor(entry: SelectableModel): Effect.Effect<LLMClient, AgentError> {
  return Effect.gen(function* () {
    const apiKey = process.env[entry.api_key_env] || process.env.OPENAI_API_KEY || '';
    if (!apiKey) {
      return yield* Effect.fail(
        new AgentError(
          'CONFIG_MISSING',
          `API key not found. Set environment variable "${entry.api_key_env}" or "OPENAI_API_KEY".`,
          { context: { apiKeyEnv: entry.api_key_env } }
        )
      );
    }

    switch (entry.driver) {
      case 'openai': {
        const { createOpenAI } = yield* Effect.tryPromise({
          try: () => import('@ai-sdk/openai'),
          catch: (e) => new AgentError('CONFIG_INVALID', `Failed to import openai driver: ${e}`),
        });
        const provider = createOpenAI({
          name: entry.provider,
          baseURL: entry.base_url,
          apiKey,
        });
        const model =
          entry.protocol === 'openai-responses'
            ? provider.responses(entry.model)
            : provider.chat(entry.model);
        return new OpenAIProvider(model, entry);
      }
      case 'deepseek': {
        const { createDeepSeek } = yield* Effect.tryPromise({
          try: () => import('@ai-sdk/deepseek'),
          catch: (e) => new AgentError('CONFIG_INVALID', `Failed to import deepseek driver: ${e}`),
        });
        const deepseek = createDeepSeek({
          baseURL: entry.base_url,
          apiKey,
        });
        return new DeepSeekProvider(deepseek(entry.model), entry);
      }
      default:
        return yield* Effect.fail(
          new AgentError(
            'CONFIG_INVALID',
            `Unknown driver "${entry.driver}" for provider "${entry.provider}"`
          )
        );
    }
  });
}

async function runOrThrow<A>(eff: Effect.Effect<A, AgentError>): Promise<A> {
  const result = await Effect.runPromise(Effect.either(eff));
  if (result._tag === 'Left') throw result.left;
  return result.right;
}

export const LlmLayer = Layer.succeed(LLMService, {
  complete(req: LLMInvocation): Effect.Effect<LLMResponse, AgentError> {
    return Effect.gen(function* () {
      const entry = yield* entryFor(req.model);
      const client = yield* clientFor(entry);
      return yield* client.complete(req);
    });
  },

  completeStream(req: LLMInvocation): AsyncIterable<LLMStreamPart> {
    return (async function* () {
      const entry = await runOrThrow(entryFor(req.model));
      const client = await runOrThrow(clientFor(entry));
      yield* client.completeStream(req);
    })();
  },
});
