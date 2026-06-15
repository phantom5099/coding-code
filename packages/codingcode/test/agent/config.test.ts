import { describe, it, expect, vi } from 'vitest';
import { resolveConfig } from '../../src/agent/config.js';

vi.mock('@codingcode/infra/config', () => ({
  loadConfig: () => ({
    context: {
      compactionModel: '',
    },
    memory: {
      enabled: false,
      model: '',
      projectFile: '',
      userFile: '',
      maxBytes: 16384,
      promptMaxBytes: 8192,
      extraTypes: [],
      disabledTypes: [],
    },
    server: { port: 8080 },
  }),
}));

describe('resolveConfig', () => {
  it('returns maxStopContinuations defaulting to 3 when no config file is present', () => {
    const cfg = resolveConfig();
    expect(cfg.maxStopContinuations).toBe(3);
  });

  it('returns maxSteps defaulting to 50 when no config file is present', () => {
    const cfg = resolveConfig();
    expect(cfg.maxSteps).toBe(250);
  });
});
