/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useAgentStore } from '../src/stores/agent.store';
import { useWorkspaceStore } from '../src/stores/workspace.store';
import { useAgentRollback } from '../src/hooks/useAgent';

const { rollbackContextMock, rollbackBothToTurnMock } = vi.hoisted(() => ({
  rollbackContextMock: vi.fn(),
  rollbackBothToTurnMock: vi.fn(),
}));

vi.mock('../src/lib/core-api', () => ({
  rollbackContext: rollbackContextMock,
  rollbackBothToTurn: rollbackBothToTurnMock,
  deleteSession: vi.fn(),
  listSessions: vi.fn(),
  getCheckpointDiff: vi.fn(),
  revertFile: vi.fn(),
  revertFiles: vi.fn(),
  previewRollbackDiff: vi.fn(),
  rollbackCodeToTurn: vi.fn(),
  undoLastCodeRollback: vi.fn(),
  getRollbackState: vi.fn(),
  forkSession: vi.fn(),
  listModels: vi.fn(),
  switchModel: vi.fn(),
  listAgents: vi.fn(),
  createSession: vi.fn(),
  getSessionHistory: vi.fn(),
  resumeSession: vi.fn(),
  setSessionPermissionMode: vi.fn(),
  sendApprovalResponse: vi.fn(),
  getMemoryConfig: vi.fn(),
  setMemoryEnabled: vi.fn(),
  setMemoryTypeDisabled: vi.fn(),
  createMemoryExtraType: vi.fn(),
  updateMemoryExtraType: vi.fn(),
  deleteMemoryExtraType: vi.fn(),
  setMemoryModel: vi.fn(),
  setAgentConfig: vi.fn(),
  getAgentConfig: vi.fn(),
  setCompactionModel: vi.fn(),
  listMcpServers: vi.fn(),
  setMcpDisabled: vi.fn(),
  resetMcpDisabled: vi.fn(),
  createMcpServer: vi.fn(),
  updateMcpServer: vi.fn(),
  deleteMcpServer: vi.fn(),
  setAgentDisabled: vi.fn(),
  resetAgentDisabled: vi.fn(),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(),
  getSubagentEnabled: vi.fn(),
  setSubagentEnabled: vi.fn(),
  resetSubagentEnabled: vi.fn(),
  listSkills: vi.fn(),
  toggleSkill: vi.fn(),
  listHooks: vi.fn(),
  createHook: vi.fn(),
  updateHook: vi.fn(),
  deleteHook: vi.fn(),
  listAutomations: vi.fn(),
  createAutomation: vi.fn(),
  updateAutomation: vi.fn(),
  runAutomationOnce: vi.fn(),
}));

function resetStores() {
  useAgentStore.setState({
    currentThreadId: 'thread-1',
    threads: {
      'thread-1': {
        id: 'thread-1',
        projectId: '',
        title: 't1',
        cwd: '/test/cwd',
        turns: [],
        createdAt: 0,
        updatedAt: 0,
      },
    },
    approvalPolicy: 'ask-all',
    model: 'model-1',
    models: [{ id: 'model-1', provider: 'p', name: 'm1', context_window: 128000 } as any],
    contextUsage: null,
    todoByThreadId: {},
    pendingInput: null,
    usageByThreadId: {},
    isCompressing: false,
    automations: [],
  });
  useWorkspaceStore.setState({
    rootPath: '/test/cwd',
    name: 'test',
    projects: [],
    currentProjectId: '',
    git: { branch: 'main', isDirty: false, staged: [], unstaged: [] },
  });
}

beforeEach(() => {
  rollbackContextMock.mockReset();
  rollbackBothToTurnMock.mockReset();
  resetStores();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useAgentRollback().rollbackCtx - per-thread usage from server', () => {
  it('adopts the server usage when the rolled-back state still has prior assistant usage', async () => {
    act(() => {
      useAgentStore.getState().setThreadUsage('thread-1', {
        prompt: 3000,
        completion: 500,
        total: 3500,
      });
    });

    rollbackContextMock.mockResolvedValue({
      turns: [],
      rolledBackMessage: null,
      promptEstimate: 1200,
      usage: { prompt: 800, completion: 400, total: 1200 },
    });

    const { result } = renderHook(() => useAgentRollback());
    await act(async () => {
      await result.current.rollbackCtx('thread-1', 2);
    });

    expect(useAgentStore.getState().usageByThreadId['thread-1']).toEqual({
      prompt: 800,
      completion: 400,
      total: 1200,
    });
    expect(useAgentStore.getState().contextUsage).toEqual({
      used: 1200,
      contextWindow: 128000,
    });
  });

  it('falls back to zeros when the server returns no usage (first-round rollback)', async () => {
    act(() => {
      useAgentStore.getState().setThreadUsage('thread-1', {
        prompt: 3000,
        completion: 500,
        total: 3500,
      });
    });

    rollbackContextMock.mockResolvedValue({
      turns: [],
      rolledBackMessage: 'first prompt',
      promptEstimate: 0,
    });

    const { result } = renderHook(() => useAgentRollback());
    await act(async () => {
      await result.current.rollbackCtx('thread-1', 1);
    });

    expect(useAgentStore.getState().usageByThreadId['thread-1']).toEqual({
      prompt: 0,
      completion: 0,
      total: 0,
    });
    expect(useAgentStore.getState().contextUsage).toEqual({
      used: 0,
      contextWindow: 128000,
    });
  });

  it('uses promptEstimate for contextUsage.used when usage is also provided', async () => {
    rollbackContextMock.mockResolvedValue({
      turns: [],
      rolledBackMessage: null,
      promptEstimate: 1234,
      usage: { prompt: 800, completion: 400, total: 1200 },
    });

    const { result } = renderHook(() => useAgentRollback());
    await act(async () => {
      await result.current.rollbackCtx('thread-1', 2);
    });

    expect(useAgentStore.getState().contextUsage?.used).toBe(1234);
    expect(useAgentStore.getState().usageByThreadId['thread-1']).toEqual({
      prompt: 800,
      completion: 400,
      total: 1200,
    });
  });

  it('refills the rolled-back message into pendingInput', async () => {
    rollbackContextMock.mockResolvedValue({
      turns: [],
      rolledBackMessage: 'first prompt',
      promptEstimate: 0,
      usage: undefined,
    });

    const { result } = renderHook(() => useAgentRollback());
    await act(async () => {
      await result.current.rollbackCtx('thread-1', 1);
    });

    expect(useAgentStore.getState().pendingInput).toBe('first prompt');
  });
});

describe('useAgentRollback().rollbackBoth - per-thread usage from server', () => {
  it('adopts the server usage when the rolled-back state still has prior assistant usage', async () => {
    act(() => {
      useAgentStore.getState().setThreadUsage('thread-1', {
        prompt: 3000,
        completion: 500,
        total: 3500,
      });
    });

    rollbackBothToTurnMock.mockResolvedValue({
      turns: [],
      rolledBackMessage: null,
      codeResult: {
        reverted: false,
        throughTurnId: 0,
        affectedTurns: [],
        selectedFiles: [],
        restoreEntry: null,
      },
      promptEstimate: 1200,
      usage: { prompt: 800, completion: 400, total: 1200 },
    });

    const { result } = renderHook(() => useAgentRollback());
    await act(async () => {
      await result.current.rollbackBoth('thread-1', 2);
    });

    expect(useAgentStore.getState().usageByThreadId['thread-1']).toEqual({
      prompt: 800,
      completion: 400,
      total: 1200,
    });
    expect(useAgentStore.getState().contextUsage).toEqual({
      used: 1200,
      contextWindow: 128000,
    });
  });

  it('falls back to zeros when the server returns no usage', async () => {
    rollbackBothToTurnMock.mockResolvedValue({
      turns: [],
      rolledBackMessage: null,
      codeResult: {
        reverted: false,
        throughTurnId: 0,
        affectedTurns: [],
        selectedFiles: [],
        restoreEntry: null,
      },
      promptEstimate: 0,
    });

    const { result } = renderHook(() => useAgentRollback());
    await act(async () => {
      await result.current.rollbackBoth('thread-1', 1);
    });

    expect(useAgentStore.getState().usageByThreadId['thread-1']).toEqual({
      prompt: 0,
      completion: 0,
      total: 0,
    });
    expect(useAgentStore.getState().contextUsage).toEqual({
      used: 0,
      contextWindow: 128000,
    });
  });
});
