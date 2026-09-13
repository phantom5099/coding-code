import { describe, it, expect, vi } from 'vitest';
import { getMemoryConfig } from '../../src/memory/config.js';

vi.mock('@codingcode/infra/config', () => ({
  loadConfig: vi.fn(() => ({
    memory: { enabled: true, model: 'memory-model', promptMaxBytes: 4096 },
  })),
}));

describe('getMemoryConfig', () => {
  it('returns memory section of loaded config', () => {
    const cfg = getMemoryConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.model).toBe('memory-model');
    expect(cfg.promptMaxBytes).toBe(4096);
  });

  it('reflects updated loadConfig result', async () => {
    const { loadConfig } = await import('@codingcode/infra/config');
    vi.mocked(loadConfig).mockReturnValue({
      memory: { enabled: false, model: '', promptMaxBytes: 8192 },
    } as any);

    const cfg = getMemoryConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.model).toBe('');
  });
});
