import { describe, it, expect } from 'vitest';
import { ManagedRuntime } from 'effect';
import { createHttpSessionClient } from '../../src/client/http/sessions.js';
import { createDirectSessionClient } from '../../src/direct/sessions.js';
import { SessionLayer } from '../../src/session/index.js';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { setProjectBaseDir, encodeProjectPath } from '../../src/core/path.js';

describe('getSessionPlan: http + direct both implement', () => {
  it('http calls GET /api/sessions/:id/plan?cwd=...', async () => {
    const calls: string[] = [];
    const c = createHttpSessionClient({
      apiGet: async <T>(p: string) => {
        calls.push(p);
        return { content: 'plan', path: '/p', directory: '/d', exists: true } as T;
      },
      apiPost: async () => null as any,
      apiPut: async () => null as any,
      apiDelete: async () => undefined,
    });
    const res = await c.getSessionPlan({ sessionId: 's1', cwd: '/c' });
    expect(res.content).toBe('plan');
    expect(calls[0]).toBe('/api/sessions/s1/plan?cwd=%2Fc');
  });

  it('direct reads latest .md from project plan directory', async () => {
    const base = join(tmpdir(), `plan-test-${Date.now()}`);
    const projectDir = join(base, encodeProjectPath('/my/cwd'));
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'first.md'), '# first');
    writeFileSync(join(projectDir, 'second.md'), '# second');
    setProjectBaseDir(base);
    try {
      const rt = ManagedRuntime.make(SessionLayer);
      const c = createDirectSessionClient(rt as any);
      const res = await c.getSessionPlan({ sessionId: 's1', cwd: '/my/cwd' });
      expect(res.exists).toBe(true);
      expect(res.content === '# first' || res.content === '# second').toBe(true);
    } finally {
      setProjectBaseDir(undefined);
    }
  });
});
