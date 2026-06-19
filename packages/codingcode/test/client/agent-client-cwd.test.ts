import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';

import { WorkspaceService } from '../../src/core/workspace.js';
import { LLMFactoryService } from '../../src/llm/factory.js';
import { AgentError } from '../../src/core/error.js';
import type { LLMClient } from '../../src/llm/client.js';

const MockWorkspaceLayer = Layer.succeed(WorkspaceService, {
  getWorkspaceCwd: () => '/workspace',
} as any);

const MockLLMFactoryLayer = Layer.succeed(LLMFactoryService, {
  getLLMClient: () => Effect.succeed(null),
  listModels: () => Effect.succeed([]),
  switchModel: () => Effect.fail(new AgentError('CONFIG_INVALID', 'not found')),
  findModel: () => Effect.succeed(null),
  getActiveEntry: () => Effect.fail(new AgentError('CONFIG_INVALID', 'No active model')),
  createClient: () => Effect.succeed(null),
} as any);

const TestLayer = Layer.mergeAll(MockWorkspaceLayer, MockLLMFactoryLayer);

const noopLlm: LLMClient = {
  completeStream: () => ({
    stream: (async function* () {})(),
    response: Promise.resolve({ ok: true, value: { content: '', finishReason: 'stop' as const } }),
  }),
  complete: () => Effect.succeed({ content: '' } as any),
  modelInfo: { id: 'test', provider: 'test', name: 'Test', contextWindow: 128000 } as any,
};

const calls: Record<string, unknown[]> = {
  getSubagentEnabled: [],
  getMcpStatus: [],
  createMcpServer: [],
  updateMcpServer: [],
  deleteMcpServer: [],
  listAgents: [],
  createAgent: [],
  updateAgent: [],
  deleteAgent: [],
  listHooks: [],
  createHook: [],
  updateHook: [],
  deleteHook: [],
  toggleSkill: [],
  setAgentDisabled: [],
  setHookDisabled: [],
};

function makeMockSettings() {
  return {
    getMemoryEnabled: vi.fn().mockResolvedValue(true),
    setMemoryEnabled: vi.fn().mockResolvedValue(undefined),
    getMemoryConfig: vi.fn().mockResolvedValue({ enabled: true, types: [] }),
    setMemoryTypeDisabled: vi.fn().mockResolvedValue(undefined),
    addMemoryExtraType: vi.fn().mockResolvedValue(undefined),
    updateMemoryExtraType: vi.fn().mockResolvedValue(undefined),
    deleteMemoryExtraType: vi.fn().mockResolvedValue(undefined),
    getSubagentEnabled: vi.fn().mockImplementation((...args: unknown[]) => {
      calls.getSubagentEnabled.push(args);
      return Promise.resolve({ enabled: true, source: 'global' });
    }),
    setSubagentEnabled: vi.fn().mockResolvedValue(undefined),
    resetSubagentEnabled: vi.fn().mockResolvedValue(undefined),
    getMcpStatus: vi.fn().mockImplementation((...args: unknown[]) => {
      calls.getMcpStatus.push(args);
      return Promise.resolve([]);
    }),
    setMcpDisabled: vi.fn().mockResolvedValue(undefined),
    resetMcpDisabled: vi.fn().mockResolvedValue(undefined),
    createMcpServer: vi.fn().mockImplementation((...args: unknown[]) => {
      calls.createMcpServer.push(args);
      return Promise.resolve(undefined);
    }),
    updateMcpServer: vi.fn().mockImplementation((...args: unknown[]) => {
      calls.updateMcpServer.push(args);
      return Promise.resolve(undefined);
    }),
    deleteMcpServer: vi.fn().mockImplementation((...args: unknown[]) => {
      calls.deleteMcpServer.push(args);
      return Promise.resolve(undefined);
    }),
    listSkills: vi.fn().mockResolvedValue([]),
    toggleSkill: vi.fn().mockImplementation((...args: unknown[]) => {
      calls.toggleSkill.push(args);
      return Promise.resolve(undefined);
    }),
    listAgents: vi.fn().mockImplementation((...args: unknown[]) => {
      calls.listAgents.push(args);
      return Promise.resolve([]);
    }),
    createAgent: vi.fn().mockImplementation((...args: unknown[]) => {
      calls.createAgent.push(args);
      return Promise.resolve(undefined);
    }),
    updateAgent: vi.fn().mockImplementation((...args: unknown[]) => {
      calls.updateAgent.push(args);
      return Promise.resolve(undefined);
    }),
    deleteAgent: vi.fn().mockImplementation((...args: unknown[]) => {
      calls.deleteAgent.push(args);
      return Promise.resolve(undefined);
    }),
    setAgentDisabled: vi.fn().mockImplementation((...args: unknown[]) => {
      calls.setAgentDisabled.push(args);
      return Promise.resolve(undefined);
    }),
    resetAgentDisabled: vi.fn().mockResolvedValue(undefined),
    listHooks: vi.fn().mockImplementation((...args: unknown[]) => {
      calls.listHooks.push(args);
      return Promise.resolve([]);
    }),
    setHookDisabled: vi.fn().mockImplementation((...args: unknown[]) => {
      calls.setHookDisabled.push(args);
      return Promise.resolve(undefined);
    }),
    resetHookDisabled: vi.fn().mockResolvedValue(undefined),
    createHook: vi.fn().mockImplementation((...args: unknown[]) => {
      calls.createHook.push(args);
      return Promise.resolve(undefined);
    }),
    updateHook: vi.fn().mockImplementation((...args: unknown[]) => {
      calls.updateHook.push(args);
      return Promise.resolve(undefined);
    }),
    deleteHook: vi.fn().mockImplementation((...args: unknown[]) => {
      calls.deleteHook.push(args);
      return Promise.resolve(undefined);
    }),
    getGlobalPermissionMode: vi.fn().mockResolvedValue('default'),
    setGlobalPermissionMode: vi.fn().mockResolvedValue(undefined),
  };
}

vi.mock('../../src/client/direct/settings.js', () => ({
  createDirectSettingsClient: () => makeMockSettings(),
}));

const { createDirectClient } = await import('../../src/client/direct.js');

describe('AgentClient SDK - unified cwd forwarding', () => {
  let client: Awaited<ReturnType<typeof createDirectClient>>;

  beforeEach(async () => {
    for (const key of Object.keys(calls)) calls[key] = [];
    const rt = ManagedRuntime.make(TestLayer);
    client = await createDirectClient(noopLlm, rt);
  });

  describe('getSubagentEnabled - explicit cwd', () => {
    it('forwards project cwd from query arg', async () => {
      await client.getSubagentEnabled({ cwd: '/my-project' });
      expect(calls.getSubagentEnabled).toEqual([[{ cwd: '/my-project' }]]);
    });

    it('forwards empty cwd (= global) from query arg', async () => {
      await client.getSubagentEnabled({ cwd: '' });
      expect(calls.getSubagentEnabled).toEqual([[{ cwd: '' }]]);
    });
  });

  describe('getMcpStatus - explicit cwd', () => {
    it('forwards project cwd from query arg', async () => {
      await client.getMcpStatus({ cwd: '/my-project' });
      expect(calls.getMcpStatus).toEqual([[{ cwd: '/my-project' }]]);
    });

    it('forwards empty cwd (= global) from query arg', async () => {
      await client.getMcpStatus({ cwd: '' });
      expect(calls.getMcpStatus).toEqual([[{ cwd: '' }]]);
    });
  });

  describe('createMcpServer - explicit cwd', () => {
    it('forwards cwd as second arg, not via closure', async () => {
      await client.createMcpServer({ name: 'srv', command: 'npx' } as any, {
        cwd: '/my-project',
      });
      expect(calls.createMcpServer).toEqual([
        [{ cwd: '/my-project', server: { name: 'srv', command: 'npx' } }],
      ]);
    });
  });

  describe('updateMcpServer - explicit cwd', () => {
    it('forwards cwd as third arg', async () => {
      await client.updateMcpServer('srv', { name: 'srv', command: 'npx' } as any, {
        cwd: '/my-project',
      });
      expect(calls.updateMcpServer).toEqual([
        [{ cwd: '/my-project', name: 'srv', server: { name: 'srv', command: 'npx' } }],
      ]);
    });
  });

  describe('deleteMcpServer - explicit cwd', () => {
    it('forwards cwd as second arg', async () => {
      await client.deleteMcpServer('srv', { cwd: '/my-project' });
      expect(calls.deleteMcpServer).toEqual([[{ cwd: '/my-project', name: 'srv' }]]);
    });
  });

  describe('listAgents - explicit cwd', () => {
    it('forwards cwd from query', async () => {
      await client.listAgents({ cwd: '/my-project' });
      expect(calls.listAgents).toEqual([[{ cwd: '/my-project' }]]);
    });
  });

  describe('createAgent - explicit cwd', () => {
    it('forwards cwd as second arg', async () => {
      const profile = { name: 'a1', description: 'd', systemPrompt: 'sp' };
      await client.createAgent(profile as any, { cwd: '/my-project' });
      expect(calls.createAgent).toEqual([[{ cwd: '/my-project', profile }]]);
    });

    it('different cwds for the same agent name go to different settings calls', async () => {
      const profile = { name: 'a1', description: 'd', systemPrompt: 'sp' };
      await client.createAgent(profile as any, { cwd: '/project-a' });
      await client.createAgent(profile as any, { cwd: '/project-b' });
      expect(calls.createAgent).toEqual([
        [{ cwd: '/project-a', profile }],
        [{ cwd: '/project-b', profile }],
      ]);
    });
  });

  describe('updateAgent - explicit cwd', () => {
    it('forwards cwd as third arg', async () => {
      const profile = { name: 'a1', description: 'd', systemPrompt: 'sp' };
      await client.updateAgent('a1', profile as any, { cwd: '/my-project' });
      expect(calls.updateAgent).toEqual([[{ cwd: '/my-project', name: 'a1', profile }]]);
    });
  });

  describe('deleteAgent - explicit cwd', () => {
    it('forwards cwd as second arg', async () => {
      await client.deleteAgent('a1', { cwd: '/my-project' });
      expect(calls.deleteAgent).toEqual([[{ cwd: '/my-project', name: 'a1' }]]);
    });
  });

  describe('listHooks - explicit cwd', () => {
    it('forwards cwd from query', async () => {
      await client.listHooks({ cwd: '/my-project' });
      expect(calls.listHooks).toEqual([[{ cwd: '/my-project' }]]);
    });
  });

  describe('createHook - explicit cwd', () => {
    it('forwards cwd as second arg', async () => {
      const hook = {
        name: 'h1',
        point: 'tool.execute.before',
        type: 'observer',
        command: 'echo',
        enabled: true,
      };
      await client.createHook(hook as any, { cwd: '/my-project' });
      expect(calls.createHook).toEqual([[{ cwd: '/my-project', hook }]]);
    });
  });

  describe('updateHook - explicit cwd', () => {
    it('forwards cwd as third arg', async () => {
      const hook = {
        name: 'h1',
        point: 'tool.execute.before',
        type: 'observer',
        command: 'echo',
        enabled: true,
      };
      await client.updateHook('h1', hook as any, { cwd: '/my-project' });
      expect(calls.updateHook).toEqual([[{ cwd: '/my-project', name: 'h1', hook }]]);
    });
  });

  describe('deleteHook - explicit cwd', () => {
    it('forwards cwd as second arg', async () => {
      await client.deleteHook('h1', { cwd: '/my-project' });
      expect(calls.deleteHook).toEqual([[{ cwd: '/my-project', name: 'h1' }]]);
    });
  });
});

describe('AgentClient SDK - body-based methods still pass through', () => {
  let client: Awaited<ReturnType<typeof createDirectClient>>;

  beforeEach(async () => {
    for (const key of Object.keys(calls)) calls[key] = [];
    const rt = ManagedRuntime.make(TestLayer);
    client = await createDirectClient(noopLlm, rt);
  });

  it('toggleSkill passes body with cwd unchanged', async () => {
    await client.toggleSkill({ name: 's1', enabled: true, cwd: '/my-project' });
    expect(calls.toggleSkill).toEqual([[{ name: 's1', enabled: true, cwd: '/my-project' }]]);
  });

  it('setAgentDisabled passes body with cwd unchanged', async () => {
    await client.setAgentDisabled({ name: 'a1', disabled: true, cwd: '/my-project' });
    expect(calls.setAgentDisabled).toEqual([[{ name: 'a1', disabled: true, cwd: '/my-project' }]]);
  });

  it('setHookDisabled passes body with cwd unchanged', async () => {
    await client.setHookDisabled({ name: 'h1', disabled: true, cwd: '/my-project' });
    expect(calls.setHookDisabled).toEqual([[{ name: 'h1', disabled: true, cwd: '/my-project' }]]);
  });
});
