import { describe, it, expect, vi } from 'vitest';

vi.mock('@codingcode/infra/config', () => ({
  loadConfig: () => ({
    maxSteps: 50,
    maxStopContinuations: 2,
    memory: { enabled: true, model: 'test-model' },
    context: { compactionModel: 'gpt-4o-mini' },
  }),
  updateMemoryModel: vi.fn(),
  updateContextCompactionModel: vi.fn(),
}));

import { Effect, Layer, ManagedRuntime } from 'effect';
import { createHttpSettingsClient } from '../../src/client/http/settings.js';
import { createDirectSettingsClient } from '../../src/direct/settings.js';
import { ApprovalService } from '../../src/approval/port.js';
import { ApprovalWaitService } from '../../src/approval/wait-port.js';
import { HookService } from '../../src/hooks/port.js';
import { MemoryService } from '../../src/memory/port.js';
import { McpService } from '../../src/mcp/port.js';
import { SkillService } from '../../src/skills/port.js';
import * as infraConfig from '@codingcode/infra/config';
import { HookLayer } from '../../src/hooks/hooks.js';
import { ApprovalWaitLayer } from '../../src/approval/wait.js';
import { ApprovalLayer } from '../../src/approval/approval.js';

const TestLayer = Layer.mergeAll(
  Layer.succeed(SkillService, {
    getAll: () => Effect.succeed([]),
    findByName: () => Effect.succeed(undefined),
    select: () => Effect.succeed(undefined),
    selectImplicit: () => Effect.succeed(undefined),
    extractSkill: () => Effect.succeed([undefined, '']),
    evictProject: () => Effect.void,
  } as any),
  Layer.succeed(MemoryService, {
    getMemoryEnabled: () => true,
    setMemoryEnabled: () => {},
    loadMemoryForPrompt: () => '',
    flushSessionToMemory: () => Promise.resolve({ written: false, bytes: 0 }),
  } as any),
  Layer.succeed(McpService, {
    syncConnections: () => Effect.void,
    connectServers: () => Effect.void,
    disconnectServers: () => Effect.void,
    getServerToolNames: () => [],
    disconnectAll: () => Effect.void,
    status: () => Effect.succeed([]),
    listProjectMcpTools: () => [],
    disable: () => Effect.void,
    enable: () => Effect.void,
  } as any),
  ApprovalLayer,
  HookLayer,
  ApprovalWaitLayer
);

const rt = ManagedRuntime.make(
  TestLayer as Layer.Layer<
    SkillService | HookService | ApprovalService | McpService | ApprovalWaitService | MemoryService
  >
);

describe('setMemoryModel: http + direct both implement', () => {
  it('http calls POST /api/settings/memory/model', async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const c = createHttpSettingsClient({
      apiGet: async () => null as any,
      apiPost: async <T>(p: string, b?: unknown) => {
        calls.push({ path: p, body: b });
        return { model: (b as { model: string }).model } as T;
      },
      apiPut: async () => null as any,
      apiDelete: async () => undefined,
    });
    const res = await c.setMemoryModel('claude-3');
    expect(res.model).toBe('claude-3');
    expect(calls[0]?.path).toBe('/api/settings/memory/model');
    expect(calls[0]?.body).toEqual({ model: 'claude-3' });
  });

  it('direct calls updateMemoryModel and returns { model }', async () => {
    const c = createDirectSettingsClient(rt as any);
    const res = await c.setMemoryModel('claude-3');
    expect(res.model).toBe('claude-3');
    expect(infraConfig.updateMemoryModel).toHaveBeenCalledWith('claude-3');
  });
});

describe('getAgentConfig: http + direct both implement', () => {
  it('http calls GET /api/settings/agent/config', async () => {
    const calls: string[] = [];
    const c = createHttpSettingsClient({
      apiGet: async <T>(p: string) => {
        calls.push(p);
        return { maxSteps: 100, maxStopContinuations: 3 } as T;
      },
      apiPost: async () => null as any,
      apiPut: async () => null as any,
      apiDelete: async () => undefined,
    });
    const res = await c.getAgentConfig();
    expect(res.maxSteps).toBe(100);
    expect(calls[0]).toBe('/api/settings/agent/config');
  });

  it('direct returns loadConfig maxSteps/maxStopContinuations', async () => {
    const c = createDirectSettingsClient(rt as any);
    const res = await c.getAgentConfig();
    expect(res.maxSteps).toBe(50);
    expect(res.maxStopContinuations).toBe(2);
  });
});

describe('setCompactionModel: http + direct both implement', () => {
  it('http calls POST /api/settings/context/compaction-model', async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const c = createHttpSettingsClient({
      apiGet: async () => null as any,
      apiPost: async <T>(p: string, b?: unknown) => {
        calls.push({ path: p, body: b });
        return { compactionModel: (b as { compactionModel: string }).compactionModel } as T;
      },
      apiPut: async () => null as any,
      apiDelete: async () => undefined,
    });
    const res = await c.setCompactionModel('claude-haiku');
    expect(res.compactionModel).toBe('claude-haiku');
    expect(calls[0]?.path).toBe('/api/settings/context/compaction-model');
  });

  it('direct calls updateContextCompactionModel and returns { compactionModel }', async () => {
    const c = createDirectSettingsClient(rt as any);
    const res = await c.setCompactionModel('claude-haiku');
    expect(res.compactionModel).toBe('claude-haiku');
    expect(infraConfig.updateContextCompactionModel).toHaveBeenCalledWith('claude-haiku');
  });
});

describe('getMemoryConfig returns model field', () => {
  it('http typed return includes model', async () => {
    const c = createHttpSettingsClient({
      apiGet: async <T>() => ({ enabled: true, model: 'm' }) as T,
      apiPost: async () => null as any,
      apiPut: async () => null as any,
      apiDelete: async () => undefined,
    });
    const res = await c.getMemoryConfig();
    expect(res.model).toBe('m');
  });
});
