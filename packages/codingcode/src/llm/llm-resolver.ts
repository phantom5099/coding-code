import { Effect } from 'effect';
import { findModel, createClient } from './factory.js';
import type { LLMClient } from './client.js';

export async function resolveLLM(
  target: string | null | undefined,
  fallback: LLMClient | null,
): Promise<LLMClient | null> {
  const trimmed = target?.trim();
  if (!trimmed) return fallback;
  const found = findModel(trimmed);
  if (!found) return fallback;
  try {
    const result = await Effect.runPromise(createClient(found).pipe(Effect.either));
    return result._tag === 'Right' ? result.right : fallback;
  } catch {
    return fallback;
  }
}
