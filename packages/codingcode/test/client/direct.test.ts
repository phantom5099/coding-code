import { describe, expect, it, vi } from 'vitest';
import { createDirectClient } from '../../src/client/direct.js';

const noopLlm = {
  completeStream: () => ({
    stream: (async function* () {})(),
    response: Promise.resolve({ ok: true, value: { content: '' } }),
  }),
};

describe('createDirectClient model operations', () => {
  it('lists models from the local model catalog without HTTP', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const client = await createDirectClient(noopLlm);

    const result = await client.listModels();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.models.length).toBeGreaterThan(0);
    // activeId is null when no activeModel is set in config
    expect(result.activeId === null || typeof result.activeId === 'string').toBe(true);

    fetchSpy.mockRestore();
  });

  it('rejects unknown model switches without contacting server', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const client = await createDirectClient(noopLlm);

    await expect(client.switchModel('missing-model@MISSING_KEY')).rejects.toThrow('not found');

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
