import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/layer.js', () => ({
  AppLayer: {},
}));

import { createServer } from '../../src/server/index.js';

describe('createServer', () => {
  it('creates server without LLM client initialization', async () => {
    const app = await createServer();
    expect(app).toBeDefined();
    expect(app).toBeInstanceOf(Object);
  });

  it('health endpoint returns ok without API key', async () => {
    const app = await createServer();
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'ok' });
  });
});
