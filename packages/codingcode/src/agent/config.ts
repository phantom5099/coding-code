import { loadConfig, type AppConfig } from '@codingcode/infra/config';

export interface ResolvedConfig {
  maxSteps: number;
  maxStopContinuations: number;
}

export function resolveConfig(): ResolvedConfig {
  const cfg = loadConfig();
  return {
    maxSteps: cfg.maxSteps ?? 250,
    maxStopContinuations: cfg.maxStopContinuations ?? 3,
  };
}
