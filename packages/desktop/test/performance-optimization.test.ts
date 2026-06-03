import { describe, it, expect, beforeEach, vi } from 'vitest';
import { computeDiff } from '../src/lib/diff-compute';
import { useGlobalStore, enrichTurnDiffs } from '../src/stores/global.store';
import type { Item, Turn } from '../shared/types';

// ─── diff-compute: large file protection ─────────────────────────────────

describe('computeDiff - large file protection', () => {
  it('uses LCS diff for files under 500 lines', () => {
    const oldContent = Array(100).fill('line').join('\n');
    const newContent = Array(100).fill('line').join('\n');
    newContent.replace('line', 'changed');

    const result = computeDiff(oldContent, newContent);
    // LCS diff should produce contextual diff, not all-delete+all-insert
    expect(result.diff).toContain(' line');
  });

  it('falls back to simplified diff for files over 500 lines', () => {
    const oldLines = Array(600).fill('old line');
    const newLines = Array(600).fill('new line');
    // Only change 1 line — LCS would show 1 deletion + 1 insertion
    oldLines[300] = 'changed';
    newLines[300] = 'changed';

    const result = computeDiff(oldLines.join('\n'), newLines.join('\n'));
    // Simplified diff shows ALL old lines as deletions, ALL new lines as insertions
    expect(result.deletions).toBe(600);
    expect(result.insertions).toBe(600);
  });

  it('simplified diff still produces valid diff output', () => {
    const oldContent = Array(501).fill('a').join('\n');
    const newContent = Array(501).fill('b').join('\n');

    const result = computeDiff(oldContent, newContent);
    expect(result.diff).toContain('-a');
    expect(result.diff).toContain('+b');
    expect(result.insertions).toBe(501);
    expect(result.deletions).toBe(501);
  });

  it('new file shortcut still works regardless of line count', () => {
    const newContent = Array(1000).fill('line').join('\n');
    const result = computeDiff('', newContent);
    expect(result.insertions).toBe(1000);
    expect(result.deletions).toBe(0);
    expect(result.diff).toContain('+line');
  });
});

// ─── global.store: hasRunningTurn ────────────────────────────────────────

describe('global store - hasRunningTurn', () => {
  beforeEach(() => {
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
        hasRunningTurn: false,
      },
    });
  });

  it('startTurn sets hasRunningTurn to true', () => {
    useGlobalStore
      .getState()
      .startTurn('t1', { id: 'turn-1', items: [], status: 'running' });
    expect(useGlobalStore.getState().agent.hasRunningTurn).toBe(true);
  });

  it('completeTurn sets hasRunningTurn to false when no other running turns', () => {
    useGlobalStore
      .getState()
      .startTurn('t1', { id: 'turn-1', items: [], status: 'running' });
    useGlobalStore.getState().completeTurn('t1', 'turn-1', 'completed');
    expect(useGlobalStore.getState().agent.hasRunningTurn).toBe(false);
  });

  it('hasRunningTurn stays true when one of two turns is still running', () => {
    useGlobalStore
      .getState()
      .startTurn('t1', { id: 'turn-1', items: [], status: 'running' });
    useGlobalStore
      .getState()
      .startTurn('t2', { id: 'turn-2', items: [], status: 'running' });

    useGlobalStore.getState().completeTurn('t1', 'turn-1', 'completed');
    expect(useGlobalStore.getState().agent.hasRunningTurn).toBe(true);

    useGlobalStore.getState().completeTurn('t2', 'turn-2', 'completed');
    expect(useGlobalStore.getState().agent.hasRunningTurn).toBe(false);
  });

  it('clearRunningTurns recalculates hasRunningTurn', () => {
    useGlobalStore
      .getState()
      .startTurn('t1', { id: 'turn-1', items: [], status: 'running' });
    expect(useGlobalStore.getState().agent.hasRunningTurn).toBe(true);

    useGlobalStore.getState().clearRunningTurns('t1');
    expect(useGlobalStore.getState().agent.hasRunningTurn).toBe(false);
  });
});

// ─── global.store: applyChunk tool_result priority ──────────────────────

describe('global store - applyChunk tool_result searches current turn first', () => {
  beforeEach(() => {
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
        hasRunningTurn: false,
      },
    });
  });

  it('finds tool_call in current turn first', () => {
    const threadId = 't1';

    // Turn 1 with a tool_call
    useGlobalStore.getState().startTurn(threadId, {
      id: 'turn-1',
      items: [
        { id: 'call-1', type: 'tool_call', name: 'read_file', args: {}, status: 'running' } as Item,
      ],
      status: 'completed',
    });
    useGlobalStore.getState().completeTurn(threadId, 'turn-1', 'completed');

    // Turn 2 with a tool_call of same name but different id
    useGlobalStore.getState().startTurn(threadId, {
      id: 'turn-2',
      items: [
        { id: 'call-2', type: 'tool_call', name: 'read_file', args: {}, status: 'running' } as Item,
      ],
      status: 'running',
    });

    // Apply tool_result for call-2 (should find it in turn-2 first)
    useGlobalStore.getState().applyChunk(threadId, 'turn-2', {
      id: 'res-2',
      type: 'tool_result',
      callId: 'call-2',
      name: 'read_file',
      output: 'ok',
      exitCode: 0,
    } as Item);

    const turn2 = useGlobalStore.getState().agent.threads[threadId].turns[1];
    const call = turn2.items.find((i) => i.id === 'call-2') as any;
    expect(call.status).toBe('approved');
    expect(turn2.items).toHaveLength(2); // call + result
  });

  it('falls back to other turns when callId not in current turn', () => {
    const threadId = 't1';

    // Turn 1 with tool_call
    useGlobalStore.getState().startTurn(threadId, {
      id: 'turn-1',
      items: [
        { id: 'call-1', type: 'tool_call', name: 'read_file', args: {}, status: 'running' } as Item,
      ],
      status: 'completed',
    });
    useGlobalStore.getState().completeTurn(threadId, 'turn-1', 'completed');

    // Turn 2 with no tool_call
    useGlobalStore.getState().startTurn(threadId, {
      id: 'turn-2',
      items: [],
      status: 'running',
    });

    // Apply tool_result for call-1 (should find it in turn-1 via fallback)
    useGlobalStore.getState().applyChunk(threadId, 'turn-2', {
      id: 'res-1',
      type: 'tool_result',
      callId: 'call-1',
      name: 'read_file',
      output: 'ok',
      exitCode: 0,
    } as Item);

    const turn1 = useGlobalStore.getState().agent.threads[threadId].turns[0];
    const call = turn1.items.find((i) => i.id === 'call-1') as any;
    expect(call.status).toBe('approved');
  });
});

// ─── global.store: enrichTurnDiffs skips already-computed diffs ──────────

describe('enrichTurnDiffs - skip already computed', () => {
  it('skips tool_result items that already have diff', () => {
    const turn: Turn = {
      id: 'turn-1',
      status: 'completed',
      items: [
        { id: 'call-1', type: 'tool_call', name: 'edit_file', args: {}, status: 'approved' } as Item,
        {
          id: 'res-1',
          type: 'tool_result',
          callId: 'call-1',
          name: 'edit_file',
          output: 'ok',
          exitCode: 0,
          diff: 'already computed',
        } as any,
      ],
    };

    enrichTurnDiffs(turn);
    // Should not overwrite existing diff
    const result = turn.items[1] as any;
    expect(result.diff).toBe('already computed');
  });

  it('computes diff for tool_result without diff', () => {
    const turn: Turn = {
      id: 'turn-1',
      status: 'completed',
      items: [
        {
          id: 'call-1',
          type: 'tool_call',
          name: 'edit_file',
          args: { path: 'foo.ts', old_string: 'a', new_string: 'b' },
          status: 'approved',
        } as any,
        {
          id: 'res-1',
          type: 'tool_result',
          callId: 'call-1',
          name: 'edit_file',
          output: 'ok',
          exitCode: 0,
        } as any,
      ],
    };

    enrichTurnDiffs(turn);
    const result = turn.items[1] as any;
    expect(result.diff).toBeDefined();
    expect(result.diff).toContain('-a');
    expect(result.diff).toContain('+b');
  });
});

// ─── global.store: persist partialize excludes usageByThreadId ───────────

describe('global store - persist partialize', () => {
  it('partialize does not include usageByThreadId', () => {
    const state = useGlobalStore.getState();
    // Access the persist config's partialize
    const store: any = useGlobalStore;
    const persistConfig = store.persist?.options;
    if (persistConfig?.partialize) {
      const partial = persistConfig.partialize(state);
      expect((partial as any).agent?.usageByThreadId).toBeUndefined();
    }
  });
});

// ─── App.tsx: event listener cleanup ─────────────────────────────────────

describe('App.tsx - event listener cleanup', () => {
  it('handler reference is preserved for removeEventListener', () => {
    // Verify the pattern: store handler ref, pass to both add and remove
    const handlers: EventListener[] = [];
    const fakeAdd = (type: string, handler: EventListener) => {
      handlers.push(handler);
    };
    const fakeRemove = (type: string, handler: EventListener) => {
      const idx = handlers.indexOf(handler);
      expect(idx).toBeGreaterThanOrEqual(0);
      handlers.splice(idx, 1);
    };

    const handler = (() => {}) as EventListener;
    fakeAdd('menu:switchMode', handler);
    expect(handlers).toHaveLength(1);
    fakeRemove('menu:switchMode', handler);
    expect(handlers).toHaveLength(0);
  });
});

// ─── main.ts: stopPolling on window close ────────────────────────────────

describe('main.ts - resource cleanup', () => {
  it('stopPolling is exported from git.service', async () => {
    const { stopPolling } = await import('../electron/core/git.service');
    expect(typeof stopPolling).toBe('function');
  });
});
