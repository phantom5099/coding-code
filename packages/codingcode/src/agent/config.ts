import { getConfig } from '../core/workspace.js';

export interface ResolvedConfig {
  maxSteps: number;
  maxStopContinuations: number;
}

export function resolveConfig(): ResolvedConfig {
  const cfg = getConfig();
  return { maxSteps: cfg.maxSteps, maxStopContinuations: cfg.maxStopContinuations };
}
