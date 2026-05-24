import { findModel, createClient } from '../../llm/factory.js';
import type { LLMClient } from '../../llm/client.js';
import type { ContextConfig } from '../config.js';

/**
 * Resolve which LLM client to use for compaction.
 *
 * Selection order:
 *   1. If `config.compactionModel` is empty → fallback (main session LLM).
 *   2. Match in `config/models.json` with priority:
 *        1) Full id format (e.g. "deepseek-chat@DEEPSEEK_API_KEY") - exact match only
 *        2) Bare model id (e.g. "deepseek-chat") - first match
 *        3) Display name (e.g. "DeepSeek Chat") - first match
 *      To avoid ambiguity when multiple providers have same model name, use full id.
 *   3. If no match or build fails → fallback.
 */
export async function resolveCompactionLLM(
  config: ContextConfig,
  fallback: LLMClient | null,
): Promise<LLMClient | null> {
  const target = config.compactionModel?.trim();
  if (!target) return fallback;

  const found = findModel(target);
  if (!found) return fallback;

  try {
    const created = await createClient(found);
    return created.ok ? created.value : fallback;
  } catch {
    return fallback;
  }
}
