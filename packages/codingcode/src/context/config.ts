import { loadConfig, type ContextConfig } from '@codingcode/infra';

export type { ContextConfig } from '@codingcode/infra';

export function getContextConfig(): ContextConfig {
  return loadConfig().context;
}
