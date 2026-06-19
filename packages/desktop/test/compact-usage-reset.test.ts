/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from '../src/stores/agent.store';
import { useWorkspaceStore } from '../src/stores/workspace.store';

// Reconstruct the side-effect block from useAgentCore.streamChunkToItem for the
// 'reactive_compact' case. This mirrors the actual implementation so we can
// exercise it without rendering the full hook.
function handleReactiveCompact(threadId: string, event: { promptEstimate: number }): void {
  const contextUsage = useAgentStore.getState().contextUsage;
  if (contextUsage) {
    useAgentStore.getState().setContextUsage({
      used: event.promptEstimate,
      contextWindow: contextUsage.contextWindow,
    });
  }
  useAgentStore.getState().clearThreadUsage(threadId);
}

// Reconstruct the manual /compact handler from AgentWorkspace.ContextIndicator.
// Mirrors the onClick body so we can drive it without rendering the component.
async function runManualCompact(
  threadId: string,
  response: { didCompress: boolean; promptEstimate: number; released: number }
): Promise<void> {
  // mirrors: if (res.didCompress && contextUsage) { setContextUsage(...); clearThreadUsage(threadId); }
  const contextUsage = useAgentStore.getState().contextUsage;
  if (response.didCompress && contextUsage) {
    useAgentStore.getState().setContextUsage({
      used: response.promptEstimate,
      contextWindow: contextUsage.contextWindow,
    });
    useAgentStore.getState().clearThreadUsage(threadId);
  }
}

beforeEach(() => {
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
    contextUsage: { used: 50000, contextWindow: 128000 },
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
});

describe('reactive_compact streaming handler', () => {
  it('clears usageByThreadId for the affected thread only', () => {
    useAgentStore
      .getState()
      .setThreadUsage('thread-1', { prompt: 3000, completion: 500, total: 3500 });
    useAgentStore
      .getState()
      .setThreadUsage('thread-2', { prompt: 800, completion: 400, total: 1200 });

    handleReactiveCompact('thread-1', { promptEstimate: 1200 });

    expect(useAgentStore.getState().usageByThreadId['thread-1']).toBeUndefined();
    expect(useAgentStore.getState().usageByThreadId['thread-2']).toEqual({
      prompt: 800,
      completion: 400,
      total: 1200,
    });
  });

  it('updates contextUsage.used to the new promptEstimate', () => {
    useAgentStore.getState().setContextUsage({ used: 95000, contextWindow: 128000 });

    handleReactiveCompact('thread-1', { promptEstimate: 1200 });

    expect(useAgentStore.getState().contextUsage).toEqual({
      used: 1200,
      contextWindow: 128000,
    });
  });

  it('does not throw when contextUsage is null (e.g., model not loaded)', () => {
    useAgentStore.getState().setContextUsage(null);
    useAgentStore
      .getState()
      .setThreadUsage('thread-1', { prompt: 3000, completion: 500, total: 3500 });

    expect(() => handleReactiveCompact('thread-1', { promptEstimate: 1200 })).not.toThrow();
    expect(useAgentStore.getState().usageByThreadId['thread-1']).toBeUndefined();
  });
});

describe('manual /compact button handler (ContextIndicator)', () => {
  it('clears usageByThreadId when didCompress is true', async () => {
    useAgentStore
      .getState()
      .setThreadUsage('thread-1', { prompt: 3000, completion: 500, total: 3500 });

    await runManualCompact('thread-1', {
      didCompress: true,
      promptEstimate: 1200,
      released: 5000,
    });

    expect(useAgentStore.getState().usageByThreadId['thread-1']).toBeUndefined();
    expect(useAgentStore.getState().contextUsage).toEqual({
      used: 1200,
      contextWindow: 128000,
    });
  });

  it('does NOT update state when didCompress is false (below threshold)', async () => {
    useAgentStore
      .getState()
      .setThreadUsage('thread-1', { prompt: 3000, completion: 500, total: 3500 });
    useAgentStore.getState().setContextUsage({ used: 50000, contextWindow: 128000 });

    await runManualCompact('thread-1', {
      didCompress: false,
      promptEstimate: 45000,
      released: 0,
    });

    expect(useAgentStore.getState().usageByThreadId['thread-1']).toEqual({
      prompt: 3000,
      completion: 500,
      total: 3500,
    });
    expect(useAgentStore.getState().contextUsage).toEqual({
      used: 50000,
      contextWindow: 128000,
    });
  });
});
