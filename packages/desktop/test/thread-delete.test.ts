/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useAgentStore } from '../src/stores/agent.store';
import { useWorkspaceStore } from '../src/stores/workspace.store';
import { useAgentRollback } from '../src/hooks/useAgent';

const { deleteSessionMock, listSessionsMock } = vi.hoisted(() => ({
  deleteSessionMock: vi.fn(),
  listSessionsMock: vi.fn(),
}));

vi.mock('../src/lib/core-api', () => ({
  deleteSession: deleteSessionMock,
  listSessions: listSessionsMock,
  // other named exports are stubs (useAgentRollback only uses these two in deleteThread)
  getCheckpointDiff: vi.fn(),
  revertFile: vi.fn(),
  revertFiles: vi.fn(),
  previewRollbackDiff: vi.fn(),
  rollbackCodeToTurn: vi.fn(),
  rollbackContext: vi.fn(),
  rollbackBothToTurn: vi.fn(),
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

function resetStores({ rootPath = '/test/cwd' }: { rootPath?: string } = {}) {
  useAgentStore.setState({
    currentThreadId: null,
    threads: {},
    approvalPolicy: 'ask-all',
    model: '',
    models: [],
    contextUsage: null,
    todoByThreadId: {},
    pendingInput: null,
    usageByThreadId: {},
    isCompressing: false,
    automations: [],
  });
  useWorkspaceStore.setState({
    rootPath,
    name: 'test',
    projects: [],
    currentProjectId: '',
    git: { branch: 'main', isDirty: false, staged: [], unstaged: [] },
  });
}

beforeEach(() => {
  deleteSessionMock.mockReset();
  listSessionsMock.mockReset();
  deleteSessionMock.mockResolvedValue(undefined);
  listSessionsMock.mockResolvedValue([]);
  resetStores();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useAgentRollback().deleteThread', () => {
  it('calls deleteSession with the workspace rootPath as cwd', async () => {
    const { result } = renderHook(() => useAgentRollback());
    await act(async () => {
      await result.current.deleteThread('thread-1');
    });
    expect(deleteSessionMock).toHaveBeenCalledTimes(1);
    expect(deleteSessionMock).toHaveBeenCalledWith('thread-1', '/test/cwd');
  });

  it('refreshes the thread list after a successful delete', async () => {
    listSessionsMock.mockResolvedValue([
      {
        sessionId: 's-1',
        title: 'one',
        cwd: '/test/cwd',
        createdAt: '2024-01-01',
        updatedAt: '2024-01-02',
      },
    ]);
    const { result } = renderHook(() => useAgentRollback());
    await act(async () => {
      await result.current.deleteThread('thread-1');
    });
    expect(listSessionsMock).toHaveBeenCalledWith('/test/cwd');
    const threads = useAgentStore.getState().threads;
    expect(Object.keys(threads)).toEqual(['s-1']);
    expect(threads['s-1']?.title).toBe('one');
  });

  it('does not call listSessions when rootPath is empty', async () => {
    resetStores({ rootPath: '' });
    const { result } = renderHook(() => useAgentRollback());
    await act(async () => {
      await result.current.deleteThread('thread-1');
    });
    expect(deleteSessionMock).toHaveBeenCalledWith('thread-1', '');
    expect(listSessionsMock).not.toHaveBeenCalled();
  });

  it('clears currentThreadId when the deleted thread is the current one', async () => {
    act(() => {
      useAgentStore.setState((s) => {
        s.currentThreadId = 'thread-current';
      });
    });
    const { result } = renderHook(() => useAgentRollback());
    await act(async () => {
      await result.current.deleteThread('thread-current');
    });
    expect(useAgentStore.getState().currentThreadId).toBeNull();
  });

  it('leaves currentThreadId unchanged when deleting a non-current thread', async () => {
    act(() => {
      useAgentStore.setState((s) => {
        s.currentThreadId = 'thread-keep';
      });
    });
    const { result } = renderHook(() => useAgentRollback());
    await act(async () => {
      await result.current.deleteThread('thread-other');
    });
    expect(useAgentStore.getState().currentThreadId).toBe('thread-keep');
  });

  it('still clears currentThreadId even if the server delete fails', async () => {
    deleteSessionMock.mockRejectedValueOnce(new Error('network down'));
    act(() => {
      useAgentStore.setState((s) => {
        s.currentThreadId = 'thread-current';
      });
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useAgentRollback());
    await act(async () => {
      await result.current.deleteThread('thread-current');
    });
    expect(useAgentStore.getState().currentThreadId).toBeNull();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('still refreshes the list even if the server delete fails', async () => {
    deleteSessionMock.mockRejectedValueOnce(new Error('network down'));
    listSessionsMock.mockResolvedValue([
      {
        sessionId: 's-2',
        title: 'two',
        cwd: '/test/cwd',
        createdAt: '2024-01-01',
        updatedAt: '2024-01-02',
      },
    ]);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useAgentRollback());
    await act(async () => {
      await result.current.deleteThread('thread-1');
    });
    expect(listSessionsMock).toHaveBeenCalled();
    expect(Object.keys(useAgentStore.getState().threads)).toEqual(['s-2']);
    errSpy.mockRestore();
  });
});
