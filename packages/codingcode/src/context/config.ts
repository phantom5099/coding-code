import { loadConfig } from '@codingcode/infra/config';
import type { ContextConfig } from '@codingcode/infra/config';

export function getContextConfig(): ContextConfig {
  return loadConfig().context;
}
