/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useAgentStore } from '../src/stores/agent.store';
import MessageStream from '../src/agent/MessageStream';
import type { Turn } from '../shared/types';

const forkThreadMock = vi.fn();
const previewRollbackMock = vi.fn();

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: { count: number }) => {
    const count = options.count;
    return {
      getTotalSize: () => count * 60,
      getVirtualItems: () =>
        Array.from({ length: count }, (_, index) => ({
          key: `row-${index}`,
          index,
          start: index * 60,
          size: 60,
        })),
      measureElement: vi.fn(),
      scrollToEnd: vi.fn(),
    };
  },
}));

vi.mock('../src/hooks/useAgent', () => ({
  useAgentApproval: () => ({ approveTool: vi.fn(), rejectTool: vi.fn() }),
  useAgentRollback: () => ({
    loadCheckpointDiff: vi.fn().mockResolvedValue({ turnId: 0, files: [] }),
    revertFile: vi.fn(),
    revertFiles: vi.fn(),
    previewRollback: (...args: unknown[]) => {
      previewRollbackMock(...args);
      return Promise.resolve({});
    },
    rollbackCtx: vi.fn(),
    rollbackBoth: vi.fn(),
    undoCodeRollback: vi.fn(),
    forkThread: (...args: unknown[]) => forkThreadMock(...args),
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
    useAgentStore.setState((s) => {
      s.threads[threadId] = {
        id: threadId,
        projectId: '',
        title: threadId,
        cwd: '/test/cwd',
        turns,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    });
  });
}

function mockGetBoundingClientRect(rect: Partial<DOMRect>) {
  const baseRect: DOMRect = {
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON() {
      return {};
    },
  };
  const merged = { ...baseRect, ...rect };
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return merged;
  });
}

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
  forkThreadMock.mockReset();
  previewRollbackMock.mockReset();
  forkThreadMock.mockResolvedValue('new-session-id-1234');
  Object.defineProperty(window, 'innerWidth', { value: 1000, writable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, writable: true });
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
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('fork button via portal', () => {
  it('renders the rollback menu in document.body (not inside the virtual row)', async () => {
    setThread('t1', [
      makeTurn('1', [
        { id: 'u1', type: 'message', role: 'user', content: 'hi' },
        { id: 'a1', type: 'message', role: 'assistant', content: 'hello' },
      ]),
    ]);
    mockGetBoundingClientRect({ top: 200, right: 600, bottom: 220, width: 20, height: 20 });

    const { container } = render(<MessageStream threadId="t1" />);
    const triggerBtn = container.querySelector('button[title="回退到此"]') as HTMLElement;
    expect(triggerBtn).toBeTruthy();

    await act(async () => {
      fireEvent.click(triggerBtn);
    });

    const menu = document.body.querySelector('[data-testid="rollback-menu"]') as HTMLElement;
    expect(menu).toBeTruthy();
    expect(menu.style.position).toBe('fixed');
    expect(menu.style.zIndex).toBe('100');
  });

  it('places menu at expected fixed coordinates from getBoundingClientRect', async () => {
    setThread('t1', [
      makeTurn('1', [
        { id: 'u1', type: 'message', role: 'user', content: 'hi' },
        { id: 'a1', type: 'message', role: 'assistant', content: 'hello' },
      ]),
    ]);
    mockGetBoundingClientRect({ top: 200, right: 600, bottom: 220, width: 20, height: 20 });

    const { container } = render(<MessageStream threadId="t1" />);
    const triggerBtn = container.querySelector('button[title="回退到此"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(triggerBtn);
    });

    const menu = document.body.querySelector('[data-testid="rollback-menu"]') as HTMLElement;
    expect(menu).toBeTruthy();
    expect(menu.style.position).toBe('fixed');
    expect(menu.getAttribute('data-placement')).toBe('up');
  });

  it('flips menu below the trigger when there is no room above', async () => {
    setThread('t1', [
      makeTurn('1', [
        { id: 'u1', type: 'message', role: 'user', content: 'hi' },
        { id: 'a1', type: 'message', role: 'assistant', content: 'hello' },
      ]),
    ]);
    mockGetBoundingClientRect({ top: 10, right: 600, bottom: 30, width: 20, height: 20 });

    const { container } = render(<MessageStream threadId="t1" />);
    const triggerBtn = container.querySelector('button[title="回退到此"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(triggerBtn);
    });

    const menu = document.body.querySelector('[data-testid="rollback-menu"]') as HTMLElement;
    expect(menu).toBeTruthy();
    expect(menu.getAttribute('data-placement')).toBe('down');
  });

  it('updates menu position on scroll events', async () => {
    setThread('t1', [
      makeTurn('1', [
        { id: 'u1', type: 'message', role: 'user', content: 'hi' },
        { id: 'a1', type: 'message', role: 'assistant', content: 'hello' },
      ]),
    ]);
    let rect: Partial<DOMRect> = { top: 200, right: 600, bottom: 220, width: 20, height: 20 };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      return {
        ...{
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: 0,
          height: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        },
        ...rect,
      } as DOMRect;
    });

    const { container } = render(<MessageStream threadId="t1" />);
    const triggerBtn = container.querySelector('button[title="回退到此"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(triggerBtn);
    });
    const menu = document.body.querySelector('[data-testid="rollback-menu"]') as HTMLElement;
    const initialTop = menu.style.top;
    expect(initialTop).toBeTruthy();

    rect = { top: 400, right: 600, bottom: 420, width: 20, height: 20 };
    await act(async () => {
      window.dispatchEvent(new Event('scroll'));
    });

    const updatedMenu = document.body.querySelector('[data-testid="rollback-menu"]') as HTMLElement;
    expect(updatedMenu.style.top).not.toBe(initialTop);
  });

  it('clicking fork triggers forkThread with the correct threadId and numeric turnId', async () => {
    setThread('t1', [
      makeTurn('1', [
        { id: 'u1', type: 'message', role: 'user', content: 'hello world' },
        { id: 'a1', type: 'message', role: 'assistant', content: 'reply' },
      ]),
    ]);
    mockGetBoundingClientRect({ top: 200, right: 600, bottom: 220, width: 20, height: 20 });

    const { container } = render(<MessageStream threadId="t1" />);
    const triggerBtn = container.querySelector('button[title="回退到此"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(triggerBtn);
    });
    const forkBtn = document.body.querySelector('[data-testid="fork-menu-item"]') as HTMLElement;
    expect(forkBtn).toBeTruthy();
    expect(forkBtn.textContent).toBe('Fork from here');

    await act(async () => {
      fireEvent.click(forkBtn);
    });

    expect(forkThreadMock).toHaveBeenCalledTimes(1);
    expect(forkThreadMock).toHaveBeenCalledWith('t1', 1);
  });

  it('does not throw when forkThread rejects (try/catch surfaces error to console)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    forkThreadMock.mockRejectedValueOnce(new Error('network down'));

    setThread('t1', [
      makeTurn('1', [
        { id: 'u1', type: 'message', role: 'user', content: 'hi' },
        { id: 'a1', type: 'message', role: 'assistant', content: 'hello' },
      ]),
    ]);
    mockGetBoundingClientRect({ top: 200, right: 600, bottom: 220, width: 20, height: 20 });

    const { container } = render(<MessageStream threadId="t1" />);
    const triggerBtn = container.querySelector('button[title="回退到此"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(triggerBtn);
    });
    const forkBtn = document.body.querySelector('[data-testid="fork-menu-item"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(forkBtn);
    });

    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('menu is in document.body, not inside MessageStream DOM tree', async () => {
    setThread('t1', [
      makeTurn('1', [
        { id: 'u1', type: 'message', role: 'user', content: 'hi' },
        { id: 'a1', type: 'message', role: 'assistant', content: 'hello' },
      ]),
    ]);
    mockGetBoundingClientRect({ top: 200, right: 600, bottom: 220, width: 20, height: 20 });

    const { container } = render(<MessageStream threadId="t1" />);
    const triggerBtn = container.querySelector('button[title="回退到此"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(triggerBtn);
    });

    const menu = document.body.querySelector('[data-testid="rollback-menu"]');
    expect(container.contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
  });
});
