import { describe, it, expect } from 'vitest';
import { resolveConfig } from '../../src/agent/config.js';

describe('resolveConfig', () => {
  it('returns maxStopContinuations defaulting to 2 when no config file is present', () => {
    const cfg = resolveConfig();
    expect(cfg.maxStopContinuations).toBe(2);
  });

  it('returns maxSteps defaulting to 50 when no config file is present', () => {
    const cfg = resolveConfig();
    expect(cfg.maxSteps).toBe(50);
  });
});
