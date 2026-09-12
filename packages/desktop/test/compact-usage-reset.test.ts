/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from '../src/stores/agent.store';
import { useWorkspaceStore } from '../src/stores/workspace.store';
import { createStreamState, reduceFrame } from '../src/lib/frame-reducer';
import type { StreamEffects } from '../src/lib/frame-reducer';
import type { Frame } from '@codingcode/core/core/frame';

// 用真实 store 实现 reducer 的副作用出口，覆盖 setCompacted 的落库行为
// （与 useAgent 中 StreamEffects.setCompacted 的语义一致）。
function storeEffects(threadId: string): StreamEffects {
  return {
    applyItem: () => {},
    applyTodo: () => {},
    setUsage: (usage) => {
      useAgentStore.getState().setThreadUsage(threadId, usage);
      const s = useAgentStore.getState();
      const model = s.models.find((m) => m.id === s.model);
      if (model) {
        s.setContextUsage({ used: usage.prompt, contextWindow: model.context_window });
      }
    },
    setCompacted: () => {
      useAgentStore.getState().clearThreadUsage(threadId);
    },
    syncTurnId: () => {},
    newId: () => 'id',
  };
}

const compressFrame: Frame = {
  sessionId: 's',
  turnId: 1,
  seq: 1,
  family: 'transition',
  transition: { to: 'compress' },
};

function applyCompaction(threadId: string): void {
  reduceFrame(compressFrame, createStreamState('m1'), storeEffects(threadId));
}

describe('compaction effect (reduceFrame → store)', () => {
  it('clears usageByThreadId for the affected thread only', () => {
    useAgentStore
      .getState()
      .setThreadUsage('thread-1', { prompt: 3000, completion: 500, total: 3500 });
    useAgentStore
      .getState()
      .setThreadUsage('thread-2', { prompt: 800, completion: 400, total: 1200 });

    applyCompaction('thread-1');

    expect(useAgentStore.getState().usageByThreadId['thread-1']).toBeUndefined();
    expect(useAgentStore.getState().usageByThreadId['thread-2']).toEqual({
      prompt: 800,
      completion: 400,
      total: 1200,
    });
  });

  it('leaves contextUsage untouched on the compress frame (no numeric payload on the frame)', () => {
    applyCompaction('thread-1');
    expect(useAgentStore.getState().contextUsage).toEqual({
      used: 50000,
      contextWindow: 128000,
    });
  });

  it('adopts the real post-compaction usage from the following responded frame', () => {
    const fx = storeEffects('thread-1');
    const state = createStreamState('m1');
    reduceFrame(compressFrame, state, fx);
    reduceFrame(
      {
        sessionId: 's',
        turnId: 1,
        seq: 2,
        family: 'transition',
        transition: {
          to: 'executing',
          responded: { usage: { prompt: 700, completion: 30, total: 730 } },
        },
      },
      state,
      fx
    );

    expect(useAgentStore.getState().usageByThreadId['thread-1']).toEqual({
      prompt: 700,
      completion: 30,
      total: 730,
    });
    expect(useAgentStore.getState().contextUsage).toEqual({
      used: 700,
      contextWindow: 128000,
    });
  });

  it('does not throw when contextUsage is null (e.g., model not loaded)', () => {
    useAgentStore.getState().setContextUsage(null);
    useAgentStore
      .getState()
      .setThreadUsage('thread-1', { prompt: 3000, completion: 500, total: 3500 });

    expect(() => applyCompaction('thread-1')).not.toThrow();
    expect(useAgentStore.getState().usageByThreadId['thread-1']).toBeUndefined();
  });
});

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
