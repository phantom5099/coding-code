import { loadConfig, type ContextConfig } from '@codingcode/infra/config';

export type { ContextConfig } from '@codingcode/infra/config';

export function getContextConfig(): ContextConfig {
  return loadConfig().context;
}
