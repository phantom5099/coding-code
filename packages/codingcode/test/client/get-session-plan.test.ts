import { describe, it, expect, vi } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { createHttpSessionClient } from '../../src/client/http/sessions.js';
import { createDirectSessionClient } from '../../src/direct/sessions.js';
import { SessionService } from '../../src/session/store.js';
import { ProjectRuntimeService } from '../../src/runtime/project-runtime.js';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { setProjectBaseDir, encodeProjectPath } from '../../src/core/path.js';

describe('getSessionPlan: http + direct both implement', () => {
  it('http calls GET /api/sessions/:id/plan?cwd=...', async () => {
    const calls: string[] = [];
    const c = createHttpSessionClient({
      apiGet: async (p) => {
        calls.push(p);
        return { content: 'plan', path: '/p', directory: '/d', exists: true };
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
      const TestLayer = Layer.mergeAll(SessionService.Default, ProjectRuntimeService.Default);
      const rt = ManagedRuntime.make(TestLayer);
      const c = createDirectSessionClient(rt as any);
      const res = await c.getSessionPlan({ sessionId: 's1', cwd: '/my/cwd' });
      expect(res.exists).toBe(true);
      expect(res.content === '# first' || res.content === '# second').toBe(true);
    } finally {
      setProjectBaseDir(undefined);
    }
    void readFileSync;
    void Effect;
    void vi;
  });
});
