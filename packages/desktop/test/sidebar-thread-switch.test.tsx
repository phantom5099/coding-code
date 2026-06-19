/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useAgentStore } from '../src/stores/agent.store';
import { useUIStore } from '../src/stores/ui.store';
import { useWorkspaceStore } from '../src/stores/workspace.store';
import AgentSidebar from '../src/agent/AgentSidebar';

const deleteThreadMock = vi.fn();

vi.mock('../src/hooks/useAgent', () => ({
  useAgentRollback: () => ({
    deleteThread: deleteThreadMock,
  }),
  useAgentApproval: () => ({ approveTool: vi.fn(), rejectTool: vi.fn() }),
}));

function resetStores({ currentThreadId = null as string | null } = {}) {
  useAgentStore.setState({
    currentThreadId,
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
  useUIStore.setState({
    view: 'agent',
    sidebarCollapsed: false,
    settingsInitialTab: null,
  });
  useWorkspaceStore.setState({
    rootPath: '/test/cwd',
    name: 'test',
    projects: [],
    currentProjectId: '',
    git: { branch: 'main', isDirty: false, staged: [], unstaged: [] },
  });
}

function seedThreads() {
  act(() => {
    useAgentStore.setState((s) => {
      s.threads = {
        't-1': {
          id: 't-1',
          projectId: '',
          title: 'first',
          cwd: '/test/cwd',
          turns: [],
          createdAt: 1000,
          updatedAt: 1000,
        },
        't-2': {
          id: 't-2',
          projectId: '',
          title: 'second',
          cwd: '/test/cwd',
          turns: [],
          createdAt: 2000,
          updatedAt: 2000,
        },
      };
    });
  });
}

beforeEach(() => {
  cleanup();
  deleteThreadMock.mockReset();
  resetStores();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AgentSidebar session switching and new session', () => {
  it('clicking the "新对话" button sets currentThreadId to null', () => {
    seedThreads();
    act(() => {
      useAgentStore.setState((s) => {
        s.currentThreadId = 't-1';
      });
    });
    const { getByText } = render(<AgentSidebar />);
    const newBtn = getByText('新对话');
    act(() => {
      fireEvent.click(newBtn);
    });
    expect(useAgentStore.getState().currentThreadId).toBeNull();
  });

  it('clicking a session item in the list sets currentThreadId to that session', () => {
    seedThreads();
    act(() => {
      useAgentStore.setState((s) => {
        s.currentThreadId = 't-1';
      });
    });
    const { getByText } = render(<AgentSidebar />);
    const secondSessionBtn = getByText('second');
    act(() => {
      fireEvent.click(secondSessionBtn);
    });
    expect(useAgentStore.getState().currentThreadId).toBe('t-2');
  });

  it('clicking a session item does not throw and does not invoke deleteThread', () => {
    seedThreads();
    const { getByText } = render(<AgentSidebar />);
    const sessionBtn = getByText('first');
    expect(() => {
      act(() => {
        fireEvent.click(sessionBtn);
      });
    }).not.toThrow();
    expect(deleteThreadMock).not.toHaveBeenCalled();
  });
});
