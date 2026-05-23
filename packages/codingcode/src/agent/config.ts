import { loadConfig } from '@codingcode/infra';

export interface ResolvedConfig {
  maxSteps: number;
  maxStopContinuations: number;
}

export function resolveConfig(): ResolvedConfig {
  const cfg = loadConfig();
  return { maxSteps: cfg.maxSteps, maxStopContinuations: cfg.maxStopContinuations };
}
