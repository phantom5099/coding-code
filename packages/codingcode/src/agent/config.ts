import { loadConfig } from '@codingcode/infra';

export interface ResolvedConfig {
  maxSteps: number;
}

export function resolveConfig(): ResolvedConfig {
  return { maxSteps: loadConfig().maxSteps };
}
