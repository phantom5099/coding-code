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
    const created = await createClient(found);
    return created.ok ? created.value : fallback;
  } catch {
    return fallback;
  }
}
