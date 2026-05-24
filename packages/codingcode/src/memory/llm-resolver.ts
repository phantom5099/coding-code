import { listModels, createClient } from '../llm/factory.js';
import type { LLMStreamAdapter } from '../agent/agent.js';
import type { MemoryConfig } from '@codingcode/infra';

export async function resolveMemoryLLM(
  config: MemoryConfig,
  fallback: LLMStreamAdapter | null,
): Promise<LLMStreamAdapter | null> {
  const target = config.model?.trim();
  if (!target) return fallback;

  const listResult = listModels();
  if (!listResult.ok) return fallback;

  const found = listResult.value.find(
    (m) => m.id === target || m.model === target || m.name === target,
  );
  if (!found) return fallback;

  try {
    const created = await createClient(found);
    return created.ok ? created.value : fallback;
  } catch {
    return fallback;
  }
}
