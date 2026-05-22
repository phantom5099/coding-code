import { listModels, createClient } from '../../llm/factory.js';
import type { LLMClient } from '../../llm/client.js';
import type { ContextConfig } from '../config.js';

/**
 * Resolve which LLM client to use for compaction.
 *
 * Selection order:
 *   1. If `config.compactionModel` is empty → fallback (main session LLM).
 *   2. Match in `config/models.json` against any of:
 *        - flat id  (e.g. "deepseek-chat@deepseek")
 *        - bare model id (e.g. "deepseek-chat")
 *        - display name (e.g. "DeepSeek Chat")
 *      First match wins. If found, build a dedicated client.
 *   3. If no match or build fails → fallback.
 */
export async function resolveCompactionLLM(
  config: ContextConfig,
  fallback: LLMClient | null,
): Promise<LLMClient | null> {
  const target = config.compactionModel?.trim();
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
