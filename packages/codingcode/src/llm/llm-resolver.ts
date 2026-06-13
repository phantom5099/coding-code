import { Effect } from 'effect';
import { AgentError } from '../core/error.js';
import { LLMFactoryService } from './factory.js';
import type { LLMClient } from './client.js';

export function resolveLLM(
  target: string | null | undefined,
  fallback: LLMClient | null,
): Effect.Effect<LLMClient | null, AgentError, LLMFactoryService> {
  const trimmed = target?.trim();
  if (!trimmed) return Effect.succeed(fallback);
  return Effect.gen(function* () {
    const factory = yield* LLMFactoryService;
    const found = yield* factory.findModel(trimmed);
    if (!found) return fallback;
    const result = yield* factory.createClient(found).pipe(Effect.either);
    return result._tag === 'Right' ? result.right : fallback;
  });
}
