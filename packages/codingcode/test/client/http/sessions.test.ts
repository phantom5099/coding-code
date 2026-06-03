import { describe, it, expect, vi } from 'vitest';
import { createHttpSessionClient } from '../../../src/client/http/sessions.js';
import { createRequestHelpers } from '../../../src/client/http/request.js';

describe('createHttpSessionClient.setSessionPermissionMode', () => {
  it('calls PUT /api/sessions/:id/permission-mode', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 })
    );

    const request = createRequestHelpers('http://localhost:8080');
    const client = createHttpSessionClient(request);

    await client.setSessionPermissionMode({ sessionId: 'sess-123', mode: 'acceptEdits' as any });

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:8080/api/sessions/sess-123/permission-mode',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ mode: 'acceptEdits' }),
      })
    );

    fetchSpy.mockRestore();
  });
});
