import { describe, it, expect, vi } from 'vitest';
import { createHttpSessionClient } from '../../src/http/sessions.js';
import { createRequestHelpers } from '../../src/http/request.js';

describe('createHttpSessionClient.setSessionPermissionMode', () => {
  it('calls PUT /api/sessions/:id/permission-mode', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    const request = createRequestHelpers('http://localhost:8080');
    const client = createHttpSessionClient(request);

    await client.setSessionPermissionMode({
      sessionId: 'sess-123',
      cwd: '/test',
      mode: 'askBeforeExec',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:8080/api/sessions/sess-123/permission-mode',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ cwd: '/test', mode: 'askBeforeExec' }),
      })
    );

    fetchSpy.mockRestore();
  });
});

describe('createHttpSessionClient.stopAllSubagents', () => {
  it('calls POST /api/sessions/:id/subagents/stop and returns the stopped count', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ stopped: 2 }), { status: 200 }));

    const request = createRequestHelpers('http://localhost:8080');
    const client = createHttpSessionClient(request);

    const result = await client.stopAllSubagents({ sessionId: 'sess-123' });

    expect(result).toEqual({ stopped: 2 });
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:8080/api/sessions/sess-123/subagents/stop',
      expect.objectContaining({ method: 'POST' })
    );

    fetchSpy.mockRestore();
  });
});

describe('createHttpSessionClient.renameSession', () => {
  it('calls PUT /api/sessions/:id/title with the title body', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const request = createRequestHelpers('http://localhost:8080');
    const client = createHttpSessionClient(request);

    await client.renameSession({ sessionId: 'sess-123', cwd: '/test', title: 'My Title' });

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:8080/api/sessions/sess-123/title',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ cwd: '/test', title: 'My Title' }),
      })
    );

    fetchSpy.mockRestore();
  });
});
