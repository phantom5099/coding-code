import { listModels, createClient } from '../llm/factory.js';
import type { LLMClient } from '../llm/client.js';
import type { MemoryConfig } from '@codingcode/infra/config';

export async function resolveMemoryLLM(
  config: MemoryConfig,
  fallback: LLMClient | null
): Promise<LLMClient | null> {
  const target = config.model?.trim();
  if (!target) return fallback;

  const listResult = listModels();
  if (!listResult.ok) return fallback;

  const found = listResult.value.find(
    (m) => m.id === target || m.model === target || m.name === target
  );
  if (!found) return fallback;

  try {
    const created = await createClient(found);
    return created.ok ? created.value : fallback;
  } catch {
    return fallback;
  }
}
