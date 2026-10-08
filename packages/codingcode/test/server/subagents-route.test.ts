import { describe, it, expect } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { createServer } from '../../src/server/index.js';
import { SubagentRunRegistryService } from '../../src/subagent/registry.js';

async function makeApp(stopAll: (sessionId: string) => Effect.Effect<number>) {
  const layer = Layer.succeed(SubagentRunRegistryService, { stopAll } as any);
  return createServer(ManagedRuntime.make(layer));
}

describe('POST /api/sessions/:id/subagents/stop', () => {
  it('返回停掉的数量', async () => {
    const app = await makeApp(() => Effect.succeed(3));
    const res = await app.request('/api/sessions/s1/subagents/stop', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stopped: 3 });
  });

  it('把路径里的 sessionId 原样透给注册表', async () => {
    const seen: string[] = [];
    const app = await makeApp((sessionId) =>
      Effect.sync(() => {
        seen.push(sessionId);
        return 0;
      })
    );
    await app.request('/api/sessions/sess-42/subagents/stop', { method: 'POST' });
    expect(seen).toEqual(['sess-42']);
  });
});
