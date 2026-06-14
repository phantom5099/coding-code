import { describe, it, expect, vi } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { createAgentRouter } from '../../src/server/routes/agent.js';
import { ApprovalService } from '../../src/approval/index.js';
import { ApprovalWaitService } from '../../src/approval/async-confirm.js';
import { HookService } from '../../src/hooks/registry.js';

const MockApprovalLayer = ApprovalService.Default.pipe(
  Layer.provide(Layer.mergeAll(HookService.Default, ApprovalWaitService.Default))
);

const TestLayer = Layer.mergeAll(
  MockApprovalLayer,
  HookService.Default,
  ApprovalWaitService.Default
);

const rt = ManagedRuntime.make(TestLayer);
const agentRouter = createAgentRouter(rt);

describe('GET /permission-mode', () => {
  it('returns 200 with current permission mode', async () => {
    const res = await agentRouter.request('/permission-mode');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode: string };
    expect(body).toHaveProperty('mode');
    expect(typeof body.mode).toBe('string');
  });
});

describe('POST /permission-mode', () => {
  it('returns 200 for valid mode', async () => {
    const res = await agentRouter.request('/permission-mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'default' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode: string };
    expect(body.mode).toBe('default');
  });

  it('returns 400 for invalid mode', async () => {
    const res = await agentRouter.request('/permission-mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'invalid_mode' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Invalid mode');
  });
});

describe('old /api/agent/* routes now return 404', () => {
  it('GET /skills returns 404', async () => {
    const res = await agentRouter.request('/skills');
    expect(res.status).toBe(404);
  });

  it('GET /mcp returns 404', async () => {
    const res = await agentRouter.request('/mcp');
    expect(res.status).toBe(404);
  });

  it('GET /subagent returns 404', async () => {
    const res = await agentRouter.request('/subagent');
    expect(res.status).toBe(404);
  });

  it('GET /memory returns 404', async () => {
    const res = await agentRouter.request('/memory');
    expect(res.status).toBe(404);
  });
});
