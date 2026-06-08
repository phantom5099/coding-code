import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createHttpSettingsClient } from '../../../src/client/http/settings.js';

function createMockRequest() {
  return {
    apiGet: vi.fn().mockResolvedValue({ enabled: true }),
    apiPost: vi.fn().mockResolvedValue(undefined),
    apiPut: vi.fn().mockResolvedValue(undefined),
    apiDelete: vi.fn().mockResolvedValue(undefined),
  };
}

describe('createHttpSettingsClient - reset APIs', () => {
  let request: ReturnType<typeof createMockRequest>;
  let client: ReturnType<typeof createHttpSettingsClient>;

  beforeEach(() => {
    request = createMockRequest();
    client = createHttpSettingsClient(request as any);
  });

  describe('resetSubagentEnabled', () => {
    it('POSTs to /settings/subagent/enabled/reset with cwd query param', async () => {
      await client.resetSubagentEnabled({ cwd: '/my-project' });
      expect(request.apiPost).toHaveBeenCalledWith(
        '/api/settings/subagent/enabled/reset?cwd=%2Fmy-project',
        {}
      );
    });
  });

  describe('resetAgentDisabled', () => {
    it('POSTs to /settings/agents/:name/disabled/reset with cwd query param', async () => {
      await client.resetAgentDisabled({ name: 'my-agent', cwd: '/my-project' });
      expect(request.apiPost).toHaveBeenCalledWith(
        '/api/settings/agents/my-agent/disabled/reset?cwd=%2Fmy-project',
        {}
      );
    });

    it('encodes agent name with special characters', async () => {
      await client.resetAgentDisabled({ name: 'my agent', cwd: '/my-project' });
      expect(request.apiPost).toHaveBeenCalledWith(
        '/api/settings/agents/my%20agent/disabled/reset?cwd=%2Fmy-project',
        {}
      );
    });
  });

  describe('resetMcpDisabled', () => {
    it('POSTs to /settings/mcp/:name/disabled/reset with cwd query param', async () => {
      await client.resetMcpDisabled({ name: 'my-server', cwd: '/my-project' });
      expect(request.apiPost).toHaveBeenCalledWith(
        '/api/settings/mcp/my-server/disabled/reset?cwd=%2Fmy-project',
        {}
      );
    });
  });

  describe('resetHookDisabled', () => {
    it('POSTs to /settings/hooks/:name/disabled/reset with cwd query param', async () => {
      await client.resetHookDisabled({ name: 'my-hook', cwd: '/my-project' });
      expect(request.apiPost).toHaveBeenCalledWith(
        '/api/settings/hooks/my-hook/disabled/reset?cwd=%2Fmy-project',
        {}
      );
    });
  });
});

describe('createHttpSettingsClient - updated signatures with cwd', () => {
  let request: ReturnType<typeof createMockRequest>;
  let client: ReturnType<typeof createHttpSettingsClient>;

  beforeEach(() => {
    request = createMockRequest();
    client = createHttpSettingsClient(request as any);
  });

  describe('getSubagentEnabled', () => {
    it('GETs /settings/subagent/enabled with cwd query param', async () => {
      request.apiGet.mockResolvedValue({ enabled: true, source: 'global' });
      const result = await client.getSubagentEnabled({ cwd: '/my-project' });
      expect(request.apiGet).toHaveBeenCalledWith(
        '/api/settings/subagent/enabled?cwd=%2Fmy-project'
      );
      expect(result).toEqual({ enabled: true, source: 'global' });
    });
  });

  describe('setSubagentEnabled', () => {
    it('POSTs to /settings/subagent/enabled with cwd query param and enabled in body', async () => {
      await client.setSubagentEnabled({ enabled: false, cwd: '/my-project' });
      expect(request.apiPost).toHaveBeenCalledWith(
        '/api/settings/subagent/enabled?cwd=%2Fmy-project',
        { enabled: false }
      );
    });
  });

  describe('setMcpDisabled', () => {
    it('POSTs to /settings/mcp/:name/disabled with cwd query param', async () => {
      await client.setMcpDisabled({ name: 'my-server', disabled: true, cwd: '/my-project' });
      expect(request.apiPost).toHaveBeenCalledWith(
        '/api/settings/mcp/my-server/disabled?cwd=%2Fmy-project',
        { disabled: true }
      );
    });
  });

  describe('setAgentDisabled', () => {
    it('POSTs to /settings/agents/:name/disabled with cwd query param', async () => {
      await client.setAgentDisabled({ name: 'my-agent', disabled: true, cwd: '/my-project' });
      expect(request.apiPost).toHaveBeenCalledWith(
        '/api/settings/agents/my-agent/disabled?cwd=%2Fmy-project',
        { disabled: true }
      );
    });
  });

  describe('setHookDisabled', () => {
    it('POSTs to /settings/hooks/:name/disabled with cwd query param', async () => {
      await client.setHookDisabled({ cwd: '/my-project', name: 'my-hook', disabled: true });
      expect(request.apiPost).toHaveBeenCalledWith(
        '/api/settings/hooks/my-hook/disabled?cwd=%2Fmy-project',
        { disabled: true }
      );
    });
  });

  describe('toggleSkill', () => {
    it('POSTs to /settings/skills with cwd query param', async () => {
      await client.toggleSkill({ name: 'my-skill', enabled: true, cwd: '/my-project' });
      expect(request.apiPost).toHaveBeenCalledWith('/api/settings/skills?cwd=%2Fmy-project', {
        name: 'my-skill',
        enabled: true,
      });
    });
  });
});
