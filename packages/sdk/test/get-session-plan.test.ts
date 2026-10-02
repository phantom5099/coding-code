import { describe, it, expect } from 'vitest';
import { createHttpSessionClient } from '../src/http/sessions.js';

describe('getSessionPlan (http)', () => {
  it('calls GET /api/sessions/:id/plan?cwd=...', async () => {
    const calls: string[] = [];
    const c = createHttpSessionClient({
      apiGet: async <T>(p: string) => {
        calls.push(p);
        return { content: 'plan', path: '/p', directory: '/d', exists: true } as T;
      },
      apiPost: async () => null as any,
      apiPut: async () => null as any,
      apiPatch: async () => null as any,
      apiDelete: async () => undefined,
    });
    const res = await c.getSessionPlan({ sessionId: 's1', cwd: '/c' });
    expect(res.content).toBe('plan');
    expect(calls[0]).toBe('/api/sessions/s1/plan?cwd=%2Fc');
  });
});
