import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from '../src/stores/agent.store';
import { useWorkspaceStore } from '../src/stores/workspace.store';
import { useRollbackStore } from '../src/stores/rollback.store';
import type { Item, Turn, Project } from '../shared/types';

function freshProject(id: string, rootPath: string): Project {
  const name = rootPath.replace(/\\/g, '/').split('/').pop() || rootPath;
  return { id, name, rootPath };
}

beforeEach(() => {
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
  });
  useWorkspaceStore.setState({
    rootPath: '',
    name: '',
    projects: [],
    currentProjectId: '',
  });
});

describe('global store - agent streaming actions', () => {
  const threadId = 'thread-1';
  const turnId = 'turn-1';

  function makeTurn(items: Item[] = []): Turn {
    return { id: turnId, items, status: 'running' };
  }

  it('startTurn creates a thread if missing', () => {
    const turn = makeTurn([{ id: 'u1', type: 'message', role: 'user', content: 'hello' }]);
    useAgentStore.getState().startTurn(threadId, turn);

    const thread = useAgentStore.getState().threads[threadId];
    expect(thread).toBeDefined();
    expect(thread.turns).toHaveLength(1);
    expect(thread.turns[0].id).toBe(turnId);
    expect(thread.turns.some((t) => t.status === 'running')).toBe(true);
  });

  it('applyChunk adds streaming assistant item to turn.items and accumulates content', () => {
    const turn = makeTurn([]);
    useAgentStore.getState().startTurn(threadId, turn);

    const delta1: Item = {
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      content: 'Hello',
      partial: true,
    };
    const delta2: Item = {
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      content: ' world',
      partial: true,
    };
    useAgentStore.getState().applyChunk(threadId, turnId, delta1);
    useAgentStore.getState().applyChunk(threadId, turnId, delta2);

    const items = useAgentStore.getState().threads[threadId].turns[0].items;
    const message = items.find((i) => i.id === 'msg-1');
    expect(message).toBeDefined();
    expect((message as any).partial).toBe(true);
    expect((message as any).content).toBe('Hello world');
    expect(items.filter((i) => i.id === 'msg-1')).toHaveLength(1);
  });

  it('applyChunk commits partial=false message to turn.items', () => {
    const turn = makeTurn([]);
    useAgentStore.getState().startTurn(threadId, turn);

    // Accumulate some text
    useAgentStore.getState().applyChunk(threadId, turnId, {
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      content: 'Hello ',
      partial: true,
    });
    useAgentStore.getState().applyChunk(threadId, turnId, {
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      content: 'world',
      partial: true,
    });

    // Commit
    useAgentStore.getState().applyChunk(threadId, turnId, {
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      content: '',
      partial: false,
    });

    const items = useAgentStore.getState().threads[threadId].turns[0].items;
    const committed = items.find((i) => i.id === 'msg-1');
    expect(committed).toBeDefined();
    expect((committed as any).content).toBe('Hello world');
    expect((committed as any).partial).toBe(false);
  });

  it('applyChunk upserts tool_call by id', () => {
    const turn = makeTurn([]);
    useAgentStore.getState().startTurn(threadId, turn);

    const pending: Item = {
      id: 'call-1',
      type: 'tool_call',
      name: 'list_dir',
      args: {},
      status: 'pending',
    };
    useAgentStore.getState().applyChunk(threadId, turnId, pending);

    const running: Item = {
      id: 'call-1',
      type: 'tool_call',
      name: 'list_dir',
      args: {},
      status: 'running',
    };
    useAgentStore.getState().applyChunk(threadId, turnId, running);

    const items = useAgentStore.getState().threads[threadId].turns[0].items;
    const toolItem = items.find((i) => i.id === 'call-1');
    expect(toolItem).toBeDefined();
    expect((toolItem as any).status).toBe('pending');
    // Should have only one entry (upserted, not duplicated)
    expect(items.filter((i) => i.id === 'call-1')).toHaveLength(1);
  });

  it('applyChunk marks matching tool_call as rejected via id upsert', () => {
    const turn = makeTurn([]);
    useAgentStore.getState().startTurn(threadId, turn);

    const toolCall: Item = {
      id: 'tc-rej',
      type: 'tool_call',
      name: 'bash',
      args: {},
      status: 'pending',
    };
    useAgentStore.getState().applyChunk(threadId, turnId, toolCall);

    const denied: Item = {
      id: 'tc-rej',
      type: 'tool_call',
      name: 'bash',
      args: {},
      status: 'rejected',
    };
    useAgentStore.getState().applyChunk(threadId, turnId, denied);

    const items = useAgentStore.getState().threads[threadId].turns[0].items;
    expect(items).toHaveLength(1);
    expect((items[0] as any).status).toBe('rejected');
  });

  it('applyChunk marks matching tool_call as approved via callId', () => {
    const turn = makeTurn([]);
    useAgentStore.getState().startTurn(threadId, turn);

    const toolCall: Item = {
      id: 'tc-same',
      type: 'tool_call',
      name: 'write_file',
      args: { path: 'foo.ts' },
      status: 'running',
    };
    useAgentStore.getState().applyChunk(threadId, turnId, toolCall);

    const toolResult: Item = {
      id: 'res-1',
      type: 'tool_result',
      callId: 'tc-same',
      name: 'write_file',
      output: 'ok',
      exitCode: 0,
    };
    useAgentStore.getState().applyChunk(threadId, turnId, toolResult);

    const items = useAgentStore.getState().threads[threadId].turns[0].items;
    const call = items.find((i) => i.id === 'tc-same');
    expect(call).toBeDefined();
    expect((call as any).status).toBe('approved');
    expect(items).toHaveLength(2);
  });

  it('completeTurn marks turn completed and clears streaming', () => {
    const turn = makeTurn([]);
    useAgentStore.getState().startTurn(threadId, turn);

    useAgentStore.getState().applyChunk(threadId, turnId, {
      id: 'msg-x',
      type: 'message',
      role: 'assistant',
      content: 'hi',
      partial: true,
    });

    useAgentStore.getState().completeTurn(threadId, turnId, 'completed');

    const updatedTurn = useAgentStore.getState().threads[threadId].turns[0];
    expect(updatedTurn.status).toBe('completed');
    expect((updatedTurn.items.find((i) => i.id === 'msg-x') as any).content).toBe('hi');
    expect((updatedTurn.items.find((i) => i.id === 'msg-x') as any).partial).toBe(false);
  });

  it('completeTurn marks streaming assistant item complete without changing content', () => {
    const turn = makeTurn([]);
    useAgentStore.getState().startTurn(threadId, turn);

    // Simulate streaming without a final partial=false event (safety net)
    useAgentStore.getState().applyChunk(threadId, turnId, {
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      content: 'Hello',
      partial: true,
    });
    useAgentStore.getState().applyChunk(threadId, turnId, {
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      content: ' world',
      partial: true,
    });

    useAgentStore.getState().completeTurn(threadId, turnId, 'completed');

    const items = useAgentStore.getState().threads[threadId].turns[0].items;
    const assistantItem = items.find((i) => i.id === 'msg-1');
    expect(assistantItem).toBeDefined();
    expect((assistantItem as any).content).toBe('Hello world');
    expect((assistantItem as any).partial).toBe(false);
  });

  it('completeTurn with partial=false already received does not double-persist', () => {
    const turn = makeTurn([]);
    useAgentStore.getState().startTurn(threadId, turn);

    // Final message already committed via applyChunk partial=false
    useAgentStore.getState().applyChunk(threadId, turnId, {
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      content: 'Hello',
      partial: true,
    });
    useAgentStore.getState().applyChunk(threadId, turnId, {
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      content: '',
      partial: false,
    });

    useAgentStore.getState().completeTurn(threadId, turnId, 'completed');

    const items = useAgentStore.getState().threads[threadId].turns[0].items;
    const assistantItem = items.find((i) => i.id === 'msg-1');
    // Content comes from the committed applyChunk (which uses accumulated streaming)
    expect((assistantItem as any).content).toBe('Hello');
    expect((assistantItem as any).partial).toBe(false);
  });

  it('keeps same assistant message id isolated across threads', () => {
    const threadA = 'thread-a';
    const threadB = 'thread-b';
    useAgentStore.getState().startTurn(threadA, { id: 'turn-a', items: [], status: 'running' });
    useAgentStore.getState().startTurn(threadB, { id: 'turn-b', items: [], status: 'running' });

    useAgentStore.getState().applyChunk(threadA, 'turn-a', {
      id: 'assistant-1',
      type: 'message',
      role: 'assistant',
      content: 'A',
      partial: true,
    });
    useAgentStore.getState().applyChunk(threadB, 'turn-b', {
      id: 'assistant-1',
      type: 'message',
      role: 'assistant',
      content: 'B',
      partial: true,
    });

    const itemA = useAgentStore.getState().threads[threadA].turns[0].items[0];
    const itemB = useAgentStore.getState().threads[threadB].turns[0].items[0];
    expect((itemA as any).content).toBe('A');
    expect((itemB as any).content).toBe('B');
  });
});

describe('global store - loadThreads', () => {
  const threadId = 'thread-1';
  const turnId = 'turn-1';

  function makeTurn(items: Item[] = []): Turn {
    return { id: turnId, items, status: 'running' };
  }

  function makeThread(turns: Turn[]): import('../shared/types').Thread {
    return {
      id: threadId,
      projectId: '',
      title: 'test',
      cwd: '/foo',
      turns,
      createdAt: 1000,
      updatedAt: 2000,
    };
  }

  it('preserves in-flight thread with running turn not yet persisted by backend', () => {
    const turn = makeTurn([{ id: 'u1', type: 'message', role: 'user', content: 'hello' }]);
    useAgentStore.getState().startTurn(threadId, turn);

    // Backend returns empty list (new thread not persisted yet)
    useAgentStore.getState().loadThreads([]);

    const thread = useAgentStore.getState().threads[threadId];
    expect(thread).toBeDefined();
    expect(thread!.turns[0]!.status).toBe('running');
  });

  it('preserves in-memory turns when backend returns thread with empty turns', () => {
    const turn = makeTurn([{ id: 'u1', type: 'message', role: 'user', content: 'hello' }]);
    useAgentStore.getState().startTurn(threadId, turn);
    useAgentStore.getState().completeTurn(threadId, turnId, 'completed');

    // Backend now returns threads with empty turns (history lives in codingcode session files)
    const backendThread = makeThread([]);
    useAgentStore.getState().loadThreads([backendThread]);

    const thread = useAgentStore.getState().threads[threadId];
    // In-memory turns are preserved
    expect(thread.turns[0].items).toHaveLength(1);
    expect((thread.turns[0].items[0] as any).content).toBe('hello');
  });

  it('does not preserve completed thread absent from backend list', () => {
    const turn = makeTurn([]);
    useAgentStore.getState().startTurn(threadId, turn);
    useAgentStore.getState().completeTurn(threadId, turnId, 'completed');

    useAgentStore.getState().loadThreads([]);

    expect(useAgentStore.getState().threads[threadId]).toBeUndefined();
  });
});

describe('global store - path normalization', () => {
  it('setWorkspace normalizes Windows backslash path', () => {
    useWorkspaceStore.getState().setWorkspace('C:\\Users\\10116\\Desktop', 'Desktop');
    expect(useWorkspaceStore.getState().rootPath).toBe('c:/Users/10116/Desktop');
    expect(useWorkspaceStore.getState().name).toBe('Desktop');
  });

  it('setWorkspace normalizes uppercase drive letter', () => {
    useWorkspaceStore.getState().setWorkspace('D:/Projects/foo', 'foo');
    expect(useWorkspaceStore.getState().rootPath).toBe('d:/Projects/foo');
  });

  it('setWorkspace leaves already-normalized path unchanged', () => {
    useWorkspaceStore.getState().setWorkspace('c:/users/foo', 'foo');
    expect(useWorkspaceStore.getState().rootPath).toBe('c:/users/foo');
  });

  it('startTurn normalizes cwd so it matches backend format', () => {
    const threadId = 'thread-norm';
    useAgentStore
      .getState()
      .startTurn(
        threadId,
        { id: 'turn-1', items: [], status: 'running' },
        { cwd: 'C:\\Users\\10116\\Desktop', title: 'test' }
      );
    expect(useAgentStore.getState().threads[threadId].cwd).toBe('c:/Users/10116/Desktop');
  });

  it('normalized workspace cwd and normalized thread cwd are equal → single group', () => {
    useWorkspaceStore.getState().setWorkspace('C:\\Users\\10116\\Desktop', 'Desktop');
    useAgentStore
      .getState()
      .startTurn(
        'thread-group',
        { id: 'turn-1', items: [], status: 'running' },
        { cwd: 'C:\\Users\\10116\\Desktop' }
      );
    const { rootPath } = useWorkspaceStore.getState();
    const { cwd } = useAgentStore.getState().threads['thread-group'];
    expect(cwd).toBe(rootPath);
  });
});

describe('global store - setThreadCwd', () => {
  it('updates cwd of an existing thread', () => {
    const threadId = 'thread-cwd';
    useAgentStore
      .getState()
      .startTurn(threadId, { id: 'turn-1', items: [], status: 'running' }, { cwd: '' });

    expect(useAgentStore.getState().threads[threadId].cwd).toBe('');

    useAgentStore.getState().setThreadCwd(threadId, '/actual/path');

    expect(useAgentStore.getState().threads[threadId].cwd).toBe('/actual/path');
  });

  it('does nothing when thread does not exist', () => {
    expect(() => useAgentStore.getState().setThreadCwd('nonexistent', '/path')).not.toThrow();
  });

  it('cwd survives a loadThreads call that preserves running threads', () => {
    const threadId = 'thread-cwd2';
    useAgentStore
      .getState()
      .startTurn(threadId, { id: 'turn-1', items: [], status: 'running' }, { cwd: '' });
    useAgentStore.getState().setThreadCwd(threadId, '/actual/path');

    // Backend hasn't persisted the running thread yet — returns empty list
    useAgentStore.getState().loadThreads([]);

    expect(useAgentStore.getState().threads[threadId]!.cwd).toBe('/actual/path');
  });
});

describe('global store - per-thread isStreaming derivation', () => {
  it('thread A running does not affect thread B isStreaming', () => {
    const threadA = 'thread-a';
    const threadB = 'thread-b';

    useAgentStore.getState().startTurn(threadA, { id: 'turn-a', items: [], status: 'running' });
    useAgentStore.getState().startTurn(threadB, { id: 'turn-b', items: [], status: 'running' });

    const isStreamingA = () =>
      useAgentStore.getState().threads[threadA]?.turns.some((t) => t.status === 'running') ?? false;
    const isStreamingB = () =>
      useAgentStore.getState().threads[threadB]?.turns.some((t) => t.status === 'running') ?? false;

    expect(isStreamingA()).toBe(true);
    expect(isStreamingB()).toBe(true);

    useAgentStore.getState().completeTurn(threadA, 'turn-a', 'completed');

    // Thread A done, Thread B still running
    expect(isStreamingA()).toBe(false);
    expect(isStreamingB()).toBe(true);
  });

  it('thread with no running turns is not streaming', () => {
    const threadId = 'thread-x';
    const isStreaming = () =>
      useAgentStore.getState().threads[threadId]?.turns.some((t) => t.status === 'running') ??
      false;

    // Thread not yet created
    expect(isStreaming()).toBe(false);

    useAgentStore.getState().startTurn(threadId, { id: 'turn-1', items: [], status: 'running' });
    expect(isStreaming()).toBe(true);

    useAgentStore.getState().completeTurn(threadId, 'turn-1', 'completed');
    expect(isStreaming()).toBe(false);
  });
});

describe('global store - project management', () => {
  it('addProject adds to list', () => {
    const p = freshProject('p1', '/home/user/project-a');
    useWorkspaceStore.getState().addProject(p);
    expect(useWorkspaceStore.getState().projects).toHaveLength(1);
    expect(useWorkspaceStore.getState().projects[0].id).toBe('p1');
  });

  it('addProject does not duplicate by id', () => {
    const p = freshProject('p1', '/home/user/project-a');
    useWorkspaceStore.getState().addProject(p);
    useWorkspaceStore.getState().addProject(p);
    expect(useWorkspaceStore.getState().projects).toHaveLength(1);
  });

  it('removeProject removes from list', () => {
    useWorkspaceStore.getState().addProject(freshProject('p1', '/a'));
    useWorkspaceStore.getState().addProject(freshProject('p2', '/b'));
    useWorkspaceStore.getState().removeProject('p1');
    expect(useWorkspaceStore.getState().projects).toHaveLength(1);
    expect(useWorkspaceStore.getState().projects[0].id).toBe('p2');
  });

  it('switchProject updates currentProjectId, rootPath, and name', () => {
    useWorkspaceStore.getState().addProject(freshProject('p1', 'C:\\Users\\test\\alpha'));
    useWorkspaceStore.getState().addProject(freshProject('p2', 'D:\\beta'));

    useWorkspaceStore.getState().switchProject('p2');
    expect(useWorkspaceStore.getState().currentProjectId).toBe('p2');
    expect(useWorkspaceStore.getState().rootPath).toBe('d:/beta');
    expect(useWorkspaceStore.getState().name).toBe('beta');
  });

  it('switchProject normalizes Windows path', () => {
    useWorkspaceStore.getState().addProject(freshProject('p1', 'C:\\MyProject'));
    useWorkspaceStore.getState().switchProject('p1');
    expect(useWorkspaceStore.getState().rootPath).toBe('c:/MyProject');
  });

  it('switchProject is no-op for unknown id', () => {
    useWorkspaceStore.getState().addProject(freshProject('p1', 'C:\\ProjectA'));
    useWorkspaceStore.getState().switchProject('p1');
    useWorkspaceStore.getState().switchProject('nonexistent');
    expect(useWorkspaceStore.getState().currentProjectId).toBe('p1');
    expect(useWorkspaceStore.getState().rootPath).toBe('c:/ProjectA');
    expect(useWorkspaceStore.getState().name).toBe('ProjectA');
  });

  it('setProjects replaces entire list', () => {
    useWorkspaceStore.getState().setProjects([freshProject('p1', '/a'), freshProject('p2', '/b')]);
    expect(useWorkspaceStore.getState().projects).toHaveLength(2);
    useWorkspaceStore.getState().setProjects([freshProject('p3', '/c')]);
    expect(useWorkspaceStore.getState().projects).toHaveLength(1);
    expect(useWorkspaceStore.getState().projects[0].id).toBe('p3');
  });

  it('setCurrentProject updates only currentProjectId, not rootPath', () => {
    useWorkspaceStore.getState().setWorkspace('/some/path', 'some');
    useWorkspaceStore.getState().setCurrentProject('xyz');
    expect(useWorkspaceStore.getState().currentProjectId).toBe('xyz');
    expect(useWorkspaceStore.getState().rootPath).toBe('/some/path');
  });
});

describe('global store - token usage', () => {
  it('setThreadUsage stores usage by threadId', () => {
    useAgentStore.getState().setThreadUsage('t1', { prompt: 1000, completion: 500, total: 1500 });
    expect(useAgentStore.getState().usageByThreadId['t1']).toEqual({
      prompt: 1000,
      completion: 500,
      total: 1500,
    });
  });

  it('setThreadUsage stores usage but does not update contextUsage', () => {
    useAgentStore
      .getState()
      .setModels([{ id: 'm1', name: 'Model', provider: 'openai', context_window: 128000 }]);
    useAgentStore.getState().setModel('m1');
    useAgentStore.getState().setCurrentThread('t1');
    useAgentStore.getState().setThreadUsage('t1', { prompt: 1000, completion: 500, total: 1500 });
    expect(useAgentStore.getState().usageByThreadId['t1']).toEqual({
      prompt: 1000,
      completion: 500,
      total: 1500,
    });
    // contextUsage is no longer updated by setThreadUsage
    expect(useAgentStore.getState().contextUsage).toBeNull();
  });

  it('setCurrentThread restores contextUsage from usageByThreadId', () => {
    useAgentStore
      .getState()
      .setModels([{ id: 'm1', name: 'Model', provider: 'openai', context_window: 128000 }]);
    useAgentStore.getState().setModel('m1');
    useAgentStore.getState().setThreadUsage('t1', { prompt: 1000, completion: 500, total: 1500 });
    useAgentStore.getState().setCurrentThread('t1');
    expect(useAgentStore.getState().contextUsage).toEqual({
      used: 1500,
      contextWindow: 128000,
    });
  });

  it('setCurrentThread clears contextUsage when no usage for thread', () => {
    useAgentStore.getState().setContextUsage({ used: 100, contextWindow: 128000 });
    useAgentStore.getState().setCurrentThread('t1');
    expect(useAgentStore.getState().contextUsage).toBeNull();
  });

  it('clearThreadUsage removes the entry for a single thread', () => {
    useAgentStore.getState().setThreadUsage('t1', { prompt: 1000, completion: 500, total: 1500 });
    useAgentStore.getState().setThreadUsage('t2', { prompt: 800, completion: 400, total: 1200 });
    useAgentStore.getState().clearThreadUsage('t1');
    expect(useAgentStore.getState().usageByThreadId['t1']).toBeUndefined();
    expect(useAgentStore.getState().usageByThreadId['t2']).toEqual({
      prompt: 800,
      completion: 400,
      total: 1200,
    });
    expect('t1' in useAgentStore.getState().usageByThreadId).toBe(false);
    expect('t2' in useAgentStore.getState().usageByThreadId).toBe(true);
  });

  it('clearThreadUsage is a no-op for a threadId with no entry', () => {
    useAgentStore.getState().setThreadUsage('t1', { prompt: 1000, completion: 500, total: 1500 });
    useAgentStore.getState().clearThreadUsage('t-does-not-exist');
    expect(useAgentStore.getState().usageByThreadId['t1']).toEqual({
      prompt: 1000,
      completion: 500,
      total: 1500,
    });
  });
});

describe('global store - compressing state', () => {
  it('initial isCompressing is false', () => {
    expect(useAgentStore.getState().isCompressing).toBe(false);
  });

  it('startCompressing sets isCompressing to true', () => {
    useAgentStore.getState().startCompressing();
    expect(useAgentStore.getState().isCompressing).toBe(true);
  });

  it('stopCompressing sets isCompressing to false', () => {
    useAgentStore.getState().startCompressing();
    expect(useAgentStore.getState().isCompressing).toBe(true);
    useAgentStore.getState().stopCompressing();
    expect(useAgentStore.getState().isCompressing).toBe(false);
  });
});

describe('global store - loadThreads orphan data cleanup', () => {
  it('cleans up todoByThreadId for deleted threads', () => {
    useAgentStore
      .getState()
      .applyTodoUpdate('deleted-thread', [{ id: '1', text: 'todo', status: 'in_progress' }]);
    expect(useAgentStore.getState().todoByThreadId['deleted-thread']).toBeDefined();

    useAgentStore.getState().loadThreads([]);
    expect(useAgentStore.getState().todoByThreadId['deleted-thread']).toBeUndefined();
  });

  it('preserves todoByThreadId for threads still in the list', () => {
    useAgentStore
      .getState()
      .applyTodoUpdate('kept-thread', [{ id: '1', text: 'todo', status: 'in_progress' }]);
    useAgentStore.getState().loadThreads([
      {
        id: 'kept-thread',
        projectId: '',
        title: 'test',
        cwd: '/x',
        turns: [],
        createdAt: 1,
        updatedAt: 2,
      },
    ]);
    expect(useAgentStore.getState().todoByThreadId['kept-thread']).toBeDefined();
  });

  it('cleans up rollbackStateByThreadId for deleted threads', () => {
    useRollbackStore.getState().setRollbackState('deleted-thread', {
      context: { active: false, currentThroughTurnId: null },
      code: { canUndoLast: false, lastEntry: null, revertedFiles: [], lastEntryId: '' },
    } as any);
    useAgentStore.getState().loadThreads([]);
    expect(useRollbackStore.getState().rollbackStateByThreadId['deleted-thread']).toBeUndefined();
  });

  it('cleans up checkpointDiffByTurnId for deleted threads', () => {
    useRollbackStore.getState().setCheckpointDiff('deleted-thread', '1', {
      turnId: 1,
      files: [],
    } as any);
    useAgentStore.getState().loadThreads([]);
    expect(useRollbackStore.getState().checkpointDiffByTurnId['deleted-thread:1']).toBeUndefined();
  });

  it('cleans up revertedFilesByTurnId for deleted threads', () => {
    useRollbackStore.getState().markFileReverted('deleted-thread', '1', '/a.ts');
    useAgentStore.getState().loadThreads([]);
    expect(useRollbackStore.getState().revertedFilesByTurnId['deleted-thread:1']).toBeUndefined();
  });

  it('cleans up turnCheckpointMapping for deleted threads', () => {
    useRollbackStore.getState().setTurnCheckpointMapping('deleted-thread', 1, 'ui-1');
    useAgentStore.getState().loadThreads([]);
    expect(useRollbackStore.getState().turnCheckpointMapping['deleted-thread']).toBeUndefined();
  });

  it('preserves rollback data for threads still in the list', () => {
    useRollbackStore.getState().setRollbackState('kept-thread', {
      context: { active: false, currentThroughTurnId: null },
      code: { canUndoLast: false, lastEntry: null, revertedFiles: [], lastEntryId: '' },
    } as any);
    useRollbackStore.getState().setCheckpointDiff('kept-thread', '1', {
      turnId: 1,
      files: [],
    } as any);
    useRollbackStore.getState().markFileReverted('kept-thread', '1', '/a.ts');
    useRollbackStore.getState().setTurnCheckpointMapping('kept-thread', 1, 'ui-1');

    useAgentStore.getState().loadThreads([
      {
        id: 'kept-thread',
        projectId: '',
        title: 'test',
        cwd: '/x',
        turns: [],
        createdAt: 1,
        updatedAt: 2,
      },
    ]);

    expect(useRollbackStore.getState().rollbackStateByThreadId['kept-thread']).toBeDefined();
    expect(useRollbackStore.getState().checkpointDiffByTurnId['kept-thread:1']).toBeDefined();
    expect(useRollbackStore.getState().revertedFilesByTurnId['kept-thread:1']).toBeDefined();
    expect(useRollbackStore.getState().turnCheckpointMapping['kept-thread']).toBeDefined();
  });
});
