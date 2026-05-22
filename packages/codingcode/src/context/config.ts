import { loadConfig, type ContextConfig } from '@codingcode/infra';

export type { ContextConfig } from '@codingcode/infra';

let testOverride: Partial<ContextConfig> | null = null;

export function getContextConfig(): ContextConfig {
  if (testOverride) {
    const base = loadConfig().context;
    return { ...base, ...testOverride, thresholds: { ...base.thresholds, ...testOverride.thresholds } };
  }
  return loadConfig().context;
}

export function __setContextConfigForTest(partial: Partial<ContextConfig>): void {
  testOverride = partial;
}
