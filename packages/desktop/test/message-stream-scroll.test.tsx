/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useGlobalStore } from '../src/stores/global.store';
import MessageStream from '../src/agent/MessageStream';
import type { Turn } from '../shared/types';

let lastVirtualizerOptions: Record<string, unknown> | null = null;
const scrollToEndMock = vi.fn();
const measureElementMock = vi.fn();

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: Record<string, unknown>) => {
    lastVirtualizerOptions = options;
    return {
      getTotalSize: () => (options.count as number) * 60,
      getVirtualItems: () => [],
      measureElement: measureElementMock,
      scrollToEnd: scrollToEndMock,
    };
  },
}));

vi.mock('../src/hooks/useAgent', () => ({
  useAgentApproval: () => ({ approveTool: vi.fn(), rejectTool: vi.fn() }),
  useAgentRollback: () => ({
    loadCheckpointDiff: vi.fn().mockResolvedValue({ turnId: 0, files: [] }),
    revertFile: vi.fn(),
    revertFiles: vi.fn(),
    previewRollback: vi.fn(),
    rollbackCtx: vi.fn(),
    rollbackBoth: vi.fn(),
    undoCodeRollback: vi.fn(),
    forkThread: vi.fn(),
    initRollbackState: vi.fn(),
    deleteThread: vi.fn(),
    revertedFilesByTurnId: {},
  }),
}));

vi.mock('../src/hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({ copiedId: null, copy: vi.fn() }),
}));

function makeTurn(id: string, items: Turn['items']): Turn {
  return { id, items, status: 'completed' };
}

function setThread(threadId: string, turns: Turn[]) {
  act(() => {
    useGlobalStore.setState((s) => {
      s.agent.threads[threadId] = {
        id: threadId,
        projectId: '',
        title: threadId,
        cwd: '/cwd',
        turns,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    });
  });
}

beforeEach(() => {
  cleanup();
  scrollToEndMock.mockClear();
  measureElementMock.mockClear();
  lastVirtualizerOptions = null;
  useGlobalStore.setState({
    agent: {
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
    },
    rollback: {
      rollbackStateByThreadId: {},
      checkpointDiffByTurnId: {},
      revertedFilesByTurnId: {},
      turnCheckpointMapping: {},
    },
  });
});

describe('MessageStream scroll behavior', () => {
  it('configures virtualizer with initialOffset set to a very large value', () => {
    setThread('t1', [
      makeTurn('t1-1', [{ id: 'm1', type: 'message', role: 'user', content: 'hi' }]),
    ]);
    render(<MessageStream threadId="t1" />);
    expect(lastVirtualizerOptions).not.toBeNull();
    expect(typeof lastVirtualizerOptions!.initialOffset).toBe('function');
    expect((lastVirtualizerOptions!.initialOffset as () => number)()).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('scrolls to end instantly on initial render with messages', () => {
    setThread('t1', [
      makeTurn('t1-1', [{ id: 'm1', type: 'message', role: 'user', content: 'hi' }]),
    ]);
    render(<MessageStream threadId="t1" />);
    expect(scrollToEndMock).toHaveBeenCalledTimes(1);
    expect(scrollToEndMock).toHaveBeenCalledWith({ behavior: 'instant' });
  });

  it('does not scroll again when messages append to the same thread', () => {
    setThread('t1', [
      makeTurn('t1-1', [{ id: 'm1', type: 'message', role: 'user', content: 'hi' }]),
    ]);
    const { rerender } = render(<MessageStream threadId="t1" />);
    expect(scrollToEndMock).toHaveBeenCalledTimes(1);

    act(() => {
      setThread('t1', [
        makeTurn('t1-1', [{ id: 'm1', type: 'message', role: 'user', content: 'hi' }]),
        makeTurn('t1-2', [{ id: 'm2', type: 'message', role: 'assistant', content: 'hello' }]),
      ]);
    });

    rerender(<MessageStream threadId="t1" />);
    expect(scrollToEndMock).toHaveBeenCalledTimes(1);
  });

  it('scrolls to end when a thread starts empty and then loads messages', () => {
    setThread('t1', []);
    const { rerender } = render(<MessageStream threadId="t1" />);
    expect(scrollToEndMock).not.toHaveBeenCalled();

    act(() => {
      setThread('t1', [
        makeTurn('t1-1', [{ id: 'm1', type: 'message', role: 'user', content: 'hi' }]),
      ]);
    });

    rerender(<MessageStream threadId="t1" />);
    expect(scrollToEndMock).toHaveBeenCalledTimes(1);
    expect(scrollToEndMock).toHaveBeenCalledWith({ behavior: 'instant' });
  });

  it('scrolls to end again after switching to a different thread', () => {
    setThread('t1', [
      makeTurn('t1-1', [{ id: 'm1', type: 'message', role: 'user', content: 'hi' }]),
    ]);
    setThread('t2', [
      makeTurn('t2-1', [{ id: 'm2', type: 'message', role: 'user', content: 'yo' }]),
    ]);

    const { unmount } = render(<MessageStream threadId="t1" />);
    expect(scrollToEndMock).toHaveBeenCalledTimes(1);

    unmount();
    render(<MessageStream threadId="t2" />);
    expect(scrollToEndMock).toHaveBeenCalledTimes(2);
    expect(scrollToEndMock).toHaveBeenLastCalledWith({ behavior: 'instant' });
  });
});
