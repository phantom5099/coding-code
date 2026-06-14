import { loadConfig } from '@codingcode/infra/config';
import type { ResolvedConfig } from './types.js';

export function resolveConfig(): ResolvedConfig {
  const cfg = loadConfig();
  return {
    maxSteps: cfg.maxSteps ?? 250,
    maxStopContinuations: cfg.maxStopContinuations ?? 3,
  };
}
