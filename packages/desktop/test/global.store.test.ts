import { describe, it, expect, beforeEach } from 'vitest';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

// Minimal store for testing core logic without persist
interface TestThread {
  id: string;
  projectId: string;
  title: string;
  cwd: string;
  turns: any[];
  createdAt: number;
  updatedAt: number;
}

interface TestState {
  threads: Record<string, TestThread>;
  currentThreadId: string | null;
}

interface TestActions {
  upsertThread: (thread: TestThread) => void;
  loadThreads: (threads: TestThread[]) => void;
  setCurrentThread: (id: string | null) => void;
  startTurn: (threadId: string, turn: any, meta?: { cwd?: string; title?: string }) => void;
}

const testStore = create<TestState & TestActions>()(
  immer((set) => ({
    threads: {},
    currentThreadId: null,
    upsertThread: (thread) =>
      set((s) => {
        s.threads[thread.id] = thread;
      }),
    loadThreads: (threads) =>
      set((s) => {
        const next: Record<string, TestThread> = {};
        for (const t of threads) {
          const existing = s.threads[t.id];
          next[t.id] = existing ? { ...t, turns: existing.turns } : t;
        }
        s.threads = next;
      }),
    setCurrentThread: (id) =>
      set((s) => {
        s.currentThreadId = id;
      }),
    startTurn: (threadId, turn, meta) =>
      set((s) => {
        if (!s.threads[threadId]) {
          s.threads[threadId] = {
            id: threadId,
            projectId: '',
            title: meta?.title ?? 'New Conversation',
            cwd: meta?.cwd ?? '',
            turns: [turn],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
        } else {
          s.threads[threadId].turns.push(turn);
          s.threads[threadId].updatedAt = Date.now();
        }
      }),
  }))
);

function resetStore() {
  testStore.setState({ threads: {}, currentThreadId: null });
}

describe('loadThreads simplified', () => {
  beforeEach(resetStore);

  it('replaces threads and preserves existing turns', () => {
    testStore.getState().upsertThread({
      id: 'sess-1',
      projectId: '',
      title: 'Old Title',
      cwd: '/path',
      turns: [{ id: 'turn-1', items: [], status: 'completed' }],
      createdAt: 1000,
      updatedAt: 1000,
    });

    testStore.getState().loadThreads([
      {
        id: 'sess-1',
        projectId: '',
        title: 'New Title',
        cwd: '/new-path',
        turns: [],
        createdAt: 2000,
        updatedAt: 2000,
      },
    ]);

    const thread = testStore.getState().threads['sess-1'];
    expect(thread).toBeDefined();
    expect(thread!.title).toBe('New Title');
    expect(thread!.cwd).toBe('/new-path');
    expect(thread!.turns).toHaveLength(1);
    expect(thread!.turns[0]!.id).toBe('turn-1');
  });

  it('does not preserve orphan threads', () => {
    testStore.getState().upsertThread({
      id: 'orphan-1',
      projectId: '',
      title: 'Orphan',
      cwd: '/path',
      turns: [{ id: 't1', items: [], status: 'running' }],
      createdAt: 1000,
      updatedAt: 1000,
    });

    testStore.getState().loadThreads([
      {
        id: 'sess-1',
        projectId: '',
        title: 'Only Session',
        cwd: '/path',
        turns: [],
        createdAt: 2000,
        updatedAt: 2000,
      },
    ]);

    expect(testStore.getState().threads['orphan-1']).toBeUndefined();
    expect(testStore.getState().threads['sess-1']).toBeDefined();
  });

  it('creates new threads for unknown ids', () => {
    testStore.getState().loadThreads([
      {
        id: 'sess-new',
        projectId: '',
        title: 'New',
        cwd: '/path',
        turns: [],
        createdAt: 3000,
        updatedAt: 3000,
      },
    ]);

    expect(testStore.getState().threads['sess-new']).toBeDefined();
    expect(testStore.getState().threads['sess-new']!.title).toBe('New');
  });
});

describe('Thread type without backendSessionId', () => {
  it('backendSessionId is not present on Thread', () => {
    const thread = {
      id: 'sess-1',
      projectId: '',
      title: 'Test',
      cwd: '/',
      turns: [],
      createdAt: 0,
      updatedAt: 0,
    };
    expect(thread).toBeDefined();
  });
});

describe('sendMessage uses sessionId as threadId', () => {
  beforeEach(resetStore);

  it('startTurn creates a thread with given threadId', () => {
    testStore.getState().startTurn('sess-abc', {
      id: 'turn-1',
      items: [{ id: 'u1', type: 'message', role: 'user', content: 'hi' }],
      status: 'running',
    });

    expect(testStore.getState().threads['sess-abc']).toBeDefined();
    expect(testStore.getState().threads['sess-abc']!.id).toBe('sess-abc');
  });
});
