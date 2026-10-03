import { describe, it, expect, beforeEach } from 'vitest';
import { computeDiff } from '../src/lib/diff-compute';
import { useAgentStore } from '../src/stores/agent.store';
import type { Item } from '../shared/types';

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

// ─── agent.store: applyChunk tool_result 定位与插入位置 ───────────────────

describe('global store - applyChunk tool_result searches current turn first', () => {
  beforeEach(() => {
    useAgentStore.setState({
      currentThreadId: null,
      threads: {},
      profile: 'build', permissionMode: 'ask',
      model: '',
      models: [],
      contextUsage: null,
      todoByThreadId: {},
      pendingInput: null,
      usageByThreadId: {},
      isCompressing: false,
    });
  });

  it('finds tool_call in current turn first', () => {
    const threadId = 't1';

    // Turn 1 with a tool_call
    useAgentStore.getState().startTurn(threadId, {
      id: 'turn-1',
      items: [
        { id: 'call-1', type: 'tool_call', name: 'read_file', args: {}, status: 'running' } as Item,
      ],
      status: 'completed',
    });
    useAgentStore.getState().completeTurn(threadId, 'turn-1', 'completed');

    // Turn 2 with a tool_call of same name but different id
    useAgentStore.getState().startTurn(threadId, {
      id: 'turn-2',
      items: [
        { id: 'call-2', type: 'tool_call', name: 'read_file', args: {}, status: 'running' } as Item,
      ],
      status: 'running',
    });

    // Apply tool_result for call-2 (should find it in turn-2 first)
    useAgentStore.getState().applyChunk(threadId, 'turn-2', {
      id: 'res-2',
      type: 'tool_result',
      callId: 'call-2',
      name: 'read_file',
      output: 'ok',
      exitCode: 0,
    } as Item);

    const turn2 = useAgentStore.getState().threads[threadId].turns[1];
    const call = turn2.items.find((i) => i.id === 'call-2') as any;
    expect(call.status).toBe('approved');
    expect(turn2.items).toHaveLength(2); // call + result
  });

  it('falls back to other turns when callId not in current turn', () => {
    const threadId = 't1';

    // Turn 1 with tool_call
    useAgentStore.getState().startTurn(threadId, {
      id: 'turn-1',
      items: [
        { id: 'call-1', type: 'tool_call', name: 'read_file', args: {}, status: 'running' } as Item,
      ],
      status: 'completed',
    });
    useAgentStore.getState().completeTurn(threadId, 'turn-1', 'completed');

    // Turn 2 with no tool_call
    useAgentStore.getState().startTurn(threadId, {
      id: 'turn-2',
      items: [],
      status: 'running',
    });

    // Apply tool_result for call-1 (should find it in turn-1 via fallback)
    useAgentStore.getState().applyChunk(threadId, 'turn-2', {
      id: 'res-1',
      type: 'tool_result',
      callId: 'call-1',
      name: 'read_file',
      output: 'ok',
      exitCode: 0,
    } as Item);

    const turn1 = useAgentStore.getState().threads[threadId].turns[0];
    const call = turn1.items.find((i) => i.id === 'call-1') as any;
    expect(call.status).toBe('approved');
  });
});

describe('global store - applyChunk tool_result uses push', () => {
  beforeEach(() => {
    useAgentStore.setState({
      currentThreadId: null,
      threads: {},
      profile: 'build', permissionMode: 'ask',
      model: '',
      models: [],
      contextUsage: null,
      todoByThreadId: {},
      pendingInput: null,
      usageByThreadId: {},
      isCompressing: false,
    });
  });

  it('tool_result is pushed to end, not spliced after tool_call', () => {
    const threadId = 't1';

    useAgentStore.getState().startTurn(threadId, {
      id: 'turn-1',
      items: [
        { id: 'msg-1', type: 'message', role: 'user', content: 'hi' } as Item,
        { id: 'call-1', type: 'tool_call', name: 'read_file', args: {}, status: 'running' } as Item,
        {
          id: 'msg-2',
          type: 'message',
          role: 'assistant',
          content: 'done',
          partial: false,
        } as Item,
      ],
      status: 'running',
    });

    // Apply tool_result for call-1
    useAgentStore.getState().applyChunk(threadId, 'turn-1', {
      id: 'res-1',
      type: 'tool_result',
      callId: 'call-1',
      name: 'read_file',
      output: 'ok',
      exitCode: 0,
    } as Item);

    const turn = useAgentStore.getState().threads[threadId].turns[0];
    // tool_result should be at the end, not between call-1 and msg-2
    const lastItem = turn.items[turn.items.length - 1];
    expect(lastItem.type).toBe('tool_result');
    // msg-2 should still be at index 2 (not shifted)
    expect(turn.items[2].id).toBe('msg-2');
  });

  it('existing item indices are not shifted when tool_result is pushed', () => {
    const threadId = 't1';

    useAgentStore.getState().startTurn(threadId, {
      id: 'turn-1',
      items: [
        { id: 'call-1', type: 'tool_call', name: 'edit', args: {}, status: 'running' } as Item,
        {
          id: 'msg-1',
          type: 'message',
          role: 'assistant',
          content: 'editing',
          partial: true,
        } as Item,
      ],
      status: 'running',
    });

    // Record index of msg-1 before tool_result
    const beforeTurn = useAgentStore.getState().threads[threadId].turns[0];
    const msgIndexBefore = beforeTurn.items.findIndex((i) => i.id === 'msg-1');
    expect(msgIndexBefore).toBe(1);

    useAgentStore.getState().applyChunk(threadId, 'turn-1', {
      id: 'res-1',
      type: 'tool_result',
      callId: 'call-1',
      name: 'edit',
      output: 'ok',
      exitCode: 0,
    } as Item);

    const afterTurn = useAgentStore.getState().threads[threadId].turns[0];
    const msgIndexAfter = afterTurn.items.findIndex((i) => i.id === 'msg-1');
    // msg-1 should still be at the same index
    expect(msgIndexAfter).toBe(msgIndexBefore);
  });
});
