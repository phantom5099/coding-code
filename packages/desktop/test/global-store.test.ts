import { describe, it, expect, beforeEach } from 'vitest';
import { useGlobalStore } from '../src/stores/global.store';
import type { Item, Turn, Project } from '../shared/types';

function freshProject(id: string, rootPath: string): Project {
  const name = rootPath.replace(/\\/g, '/').split('/').pop() || rootPath;
  return { id, name, rootPath };
}

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
    },
    workspace: {
      rootPath: '',
      name: '',
      projects: [],
      currentProjectId: '',
    },
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
    useGlobalStore.getState().startTurn(threadId, turn);

    const thread = useGlobalStore.getState().agent.threads[threadId];
    expect(thread).toBeDefined();
    expect(thread.turns).toHaveLength(1);
    expect(thread.turns[0].id).toBe(turnId);
    expect(thread.turns.some((t) => t.status === 'running')).toBe(true);
  });

  it('applyChunk adds streaming assistant item to turn.items and accumulates content', () => {
    const turn = makeTurn([]);
    useGlobalStore.getState().startTurn(threadId, turn);

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
    useGlobalStore.getState().applyChunk(threadId, turnId, delta1);
    useGlobalStore.getState().applyChunk(threadId, turnId, delta2);

    const items = useGlobalStore.getState().agent.threads[threadId].turns[0].items;
    const message = items.find((i) => i.id === 'msg-1');
    expect(message).toBeDefined();
    expect((message as any).partial).toBe(true);
    expect((message as any).content).toBe('Hello world');
    expect(items.filter((i) => i.id === 'msg-1')).toHaveLength(1);
  });

  it('applyChunk commits partial=false message to turn.items', () => {
    const turn = makeTurn([]);
    useGlobalStore.getState().startTurn(threadId, turn);

    // Accumulate some text
    useGlobalStore.getState().applyChunk(threadId, turnId, {
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      content: 'Hello ',
      partial: true,
    });
    useGlobalStore.getState().applyChunk(threadId, turnId, {
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      content: 'world',
      partial: true,
    });

    // Commit
    useGlobalStore.getState().applyChunk(threadId, turnId, {
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      content: '',
      partial: false,
    });

    const items = useGlobalStore.getState().agent.threads[threadId].turns[0].items;
    const committed = items.find((i) => i.id === 'msg-1');
    expect(committed).toBeDefined();
    expect((committed as any).content).toBe('Hello world');
    expect((committed as any).partial).toBe(false);
  });

  it('applyChunk upserts tool_call by id', () => {
    const turn = makeTurn([]);
    useGlobalStore.getState().startTurn(threadId, turn);

    const pending: Item = {
      id: 'call-1',
      type: 'tool_call',
      name: 'list_dir',
      args: {},
      status: 'pending',
    };
    useGlobalStore.getState().applyChunk(threadId, turnId, pending);

    const running: Item = {
      id: 'call-1',
      type: 'tool_call',
      name: 'list_dir',
      args: {},
      status: 'running',
    };
    useGlobalStore.getState().applyChunk(threadId, turnId, running);

    const items = useGlobalStore.getState().agent.threads[threadId].turns[0].items;
    const toolItem = items.find((i) => i.id === 'call-1');
    expect(toolItem).toBeDefined();
    expect((toolItem as any).status).toBe('pending');
    // Should have only one entry (upserted, not duplicated)
    expect(items.filter((i) => i.id === 'call-1')).toHaveLength(1);
  });

  it('applyChunk marks matching tool_call as rejected via id upsert', () => {
    const turn = makeTurn([]);
    useGlobalStore.getState().startTurn(threadId, turn);

    const toolCall: Item = {
      id: 'tc-rej',
      type: 'tool_call',
      name: 'bash',
      args: {},
      status: 'pending',
    };
    useGlobalStore.getState().applyChunk(threadId, turnId, toolCall);

    const denied: Item = {
      id: 'tc-rej',
      type: 'tool_call',
      name: 'bash',
      args: {},
      status: 'rejected',
    };
    useGlobalStore.getState().applyChunk(threadId, turnId, denied);

    const items = useGlobalStore.getState().agent.threads[threadId].turns[0].items;
    expect(items).toHaveLength(1);
    expect((items[0] as any).status).toBe('rejected');
  });

  it('applyChunk marks matching tool_call as approved via callId', () => {
    const turn = makeTurn([]);
    useGlobalStore.getState().startTurn(threadId, turn);

    const toolCall: Item = {
      id: 'tc-same',
      type: 'tool_call',
      name: 'write_file',
      args: { path: 'foo.ts' },
      status: 'running',
    };
    useGlobalStore.getState().applyChunk(threadId, turnId, toolCall);

    const toolResult: Item = {
      id: 'res-1',
      type: 'tool_result',
      callId: 'tc-same',
      name: 'write_file',
      output: 'ok',
      exitCode: 0,
    };
    useGlobalStore.getState().applyChunk(threadId, turnId, toolResult);

    const items = useGlobalStore.getState().agent.threads[threadId].turns[0].items;
    const call = items.find((i) => i.id === 'tc-same');
    expect(call).toBeDefined();
    expect((call as any).status).toBe('approved');
    expect(items).toHaveLength(2);
  });

  it('completeTurn marks turn completed and clears streaming', () => {
    const turn = makeTurn([]);
    useGlobalStore.getState().startTurn(threadId, turn);

    useGlobalStore.getState().applyChunk(threadId, turnId, {
      id: 'msg-x',
      type: 'message',
      role: 'assistant',
      content: 'hi',
      partial: true,
    });

    useGlobalStore.getState().completeTurn(threadId, turnId, 'completed');

    const updatedTurn = useGlobalStore.getState().agent.threads[threadId].turns[0];
    expect(updatedTurn.status).toBe('completed');
    expect((updatedTurn.items.find((i) => i.id === 'msg-x') as any).content).toBe('hi');
    expect((updatedTurn.items.find((i) => i.id === 'msg-x') as any).partial).toBe(false);
  });

  it('completeTurn marks streaming assistant item complete without changing content', () => {
    const turn = makeTurn([]);
    useGlobalStore.getState().startTurn(threadId, turn);

    // Simulate streaming without a final partial=false event (safety net)
    useGlobalStore.getState().applyChunk(threadId, turnId, {
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      content: 'Hello',
      partial: true,
    });
    useGlobalStore.getState().applyChunk(threadId, turnId, {
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      content: ' world',
      partial: true,
    });

    useGlobalStore.getState().completeTurn(threadId, turnId, 'completed');

    const items = useGlobalStore.getState().agent.threads[threadId].turns[0].items;
    const assistantItem = items.find((i) => i.id === 'msg-1');
    expect(assistantItem).toBeDefined();
    expect((assistantItem as any).content).toBe('Hello world');
    expect((assistantItem as any).partial).toBe(false);
  });

  it('completeTurn with partial=false already received does not double-persist', () => {
    const turn = makeTurn([]);
    useGlobalStore.getState().startTurn(threadId, turn);

    // Final message already committed via applyChunk partial=false
    useGlobalStore.getState().applyChunk(threadId, turnId, {
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      content: 'Hello',
      partial: true,
    });
    useGlobalStore.getState().applyChunk(threadId, turnId, {
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      content: '',
      partial: false,
    });

    useGlobalStore.getState().completeTurn(threadId, turnId, 'completed');

    const items = useGlobalStore.getState().agent.threads[threadId].turns[0].items;
    const assistantItem = items.find((i) => i.id === 'msg-1');
    // Content comes from the committed applyChunk (which uses accumulated streaming)
    expect((assistantItem as any).content).toBe('Hello');
    expect((assistantItem as any).partial).toBe(false);
  });

  it('keeps same assistant message id isolated across threads', () => {
    const threadA = 'thread-a';
    const threadB = 'thread-b';
    useGlobalStore.getState().startTurn(threadA, { id: 'turn-a', items: [], status: 'running' });
    useGlobalStore.getState().startTurn(threadB, { id: 'turn-b', items: [], status: 'running' });

    useGlobalStore.getState().applyChunk(threadA, 'turn-a', {
      id: 'assistant-1',
      type: 'message',
      role: 'assistant',
      content: 'A',
      partial: true,
    });
    useGlobalStore.getState().applyChunk(threadB, 'turn-b', {
      id: 'assistant-1',
      type: 'message',
      role: 'assistant',
      content: 'B',
      partial: true,
    });

    const itemA = useGlobalStore.getState().agent.threads[threadA].turns[0].items[0];
    const itemB = useGlobalStore.getState().agent.threads[threadB].turns[0].items[0];
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
    useGlobalStore.getState().startTurn(threadId, turn);

    // Backend returns empty list (new thread not persisted yet)
    useGlobalStore.getState().loadThreads([]);

    const thread = useGlobalStore.getState().agent.threads[threadId];
    expect(thread).toBeDefined();
    expect(thread!.turns[0]!.status).toBe('running');
  });

  it('preserves in-memory turns when backend returns thread with empty turns', () => {
    const turn = makeTurn([{ id: 'u1', type: 'message', role: 'user', content: 'hello' }]);
    useGlobalStore.getState().startTurn(threadId, turn);
    useGlobalStore.getState().completeTurn(threadId, turnId, 'completed');

    // Backend now returns threads with empty turns (history lives in codingcode session files)
    const backendThread = makeThread([]);
    useGlobalStore.getState().loadThreads([backendThread]);

    const thread = useGlobalStore.getState().agent.threads[threadId];
    // In-memory turns are preserved
    expect(thread.turns[0].items).toHaveLength(1);
    expect((thread.turns[0].items[0] as any).content).toBe('hello');
  });

  it('does not preserve completed thread absent from backend list', () => {
    const turn = makeTurn([]);
    useGlobalStore.getState().startTurn(threadId, turn);
    useGlobalStore.getState().completeTurn(threadId, turnId, 'completed');

    useGlobalStore.getState().loadThreads([]);

    expect(useGlobalStore.getState().agent.threads[threadId]).toBeUndefined();
  });
});

describe('global store - path normalization', () => {
  it('setWorkspace normalizes Windows backslash path', () => {
    useGlobalStore.getState().setWorkspace('C:\\Users\\10116\\Desktop', 'Desktop');
    expect(useGlobalStore.getState().workspace.rootPath).toBe('c:/Users/10116/Desktop');
    expect(useGlobalStore.getState().workspace.name).toBe('Desktop');
  });

  it('setWorkspace normalizes uppercase drive letter', () => {
    useGlobalStore.getState().setWorkspace('D:/Projects/foo', 'foo');
    expect(useGlobalStore.getState().workspace.rootPath).toBe('d:/Projects/foo');
  });

  it('setWorkspace leaves already-normalized path unchanged', () => {
    useGlobalStore.getState().setWorkspace('c:/users/foo', 'foo');
    expect(useGlobalStore.getState().workspace.rootPath).toBe('c:/users/foo');
  });

  it('startTurn normalizes cwd so it matches backend format', () => {
    const threadId = 'thread-norm';
    useGlobalStore
      .getState()
      .startTurn(
        threadId,
        { id: 'turn-1', items: [], status: 'running' },
        { cwd: 'C:\\Users\\10116\\Desktop', title: 'test' }
      );
    expect(useGlobalStore.getState().agent.threads[threadId].cwd).toBe('c:/Users/10116/Desktop');
  });

  it('normalized workspace cwd and normalized thread cwd are equal → single group', () => {
    useGlobalStore.getState().setWorkspace('C:\\Users\\10116\\Desktop', 'Desktop');
    useGlobalStore
      .getState()
      .startTurn(
        'thread-group',
        { id: 'turn-1', items: [], status: 'running' },
        { cwd: 'C:\\Users\\10116\\Desktop' }
      );
    const { rootPath } = useGlobalStore.getState().workspace;
    const { cwd } = useGlobalStore.getState().agent.threads['thread-group'];
    expect(cwd).toBe(rootPath);
  });
});

describe('global store - setThreadCwd', () => {
  it('updates cwd of an existing thread', () => {
    const threadId = 'thread-cwd';
    useGlobalStore
      .getState()
      .startTurn(threadId, { id: 'turn-1', items: [], status: 'running' }, { cwd: '' });

    expect(useGlobalStore.getState().agent.threads[threadId].cwd).toBe('');

    useGlobalStore.getState().setThreadCwd(threadId, '/actual/path');

    expect(useGlobalStore.getState().agent.threads[threadId].cwd).toBe('/actual/path');
  });

  it('does nothing when thread does not exist', () => {
    expect(() => useGlobalStore.getState().setThreadCwd('nonexistent', '/path')).not.toThrow();
  });

  it('cwd survives a loadThreads call that preserves running threads', () => {
    const threadId = 'thread-cwd2';
    useGlobalStore
      .getState()
      .startTurn(threadId, { id: 'turn-1', items: [], status: 'running' }, { cwd: '' });
    useGlobalStore.getState().setThreadCwd(threadId, '/actual/path');

    // Backend hasn't persisted the running thread yet — returns empty list
    useGlobalStore.getState().loadThreads([]);

    expect(useGlobalStore.getState().agent.threads[threadId]!.cwd).toBe('/actual/path');
  });
});

describe('global store - per-thread isStreaming derivation', () => {
  it('thread A running does not affect thread B isStreaming', () => {
    const threadA = 'thread-a';
    const threadB = 'thread-b';

    useGlobalStore.getState().startTurn(threadA, { id: 'turn-a', items: [], status: 'running' });
    useGlobalStore.getState().startTurn(threadB, { id: 'turn-b', items: [], status: 'running' });

    const isStreamingA = () =>
      useGlobalStore.getState().agent.threads[threadA]?.turns.some((t) => t.status === 'running') ??
      false;
    const isStreamingB = () =>
      useGlobalStore.getState().agent.threads[threadB]?.turns.some((t) => t.status === 'running') ??
      false;

    expect(isStreamingA()).toBe(true);
    expect(isStreamingB()).toBe(true);

    useGlobalStore.getState().completeTurn(threadA, 'turn-a', 'completed');

    // Thread A done, Thread B still running
    expect(isStreamingA()).toBe(false);
    expect(isStreamingB()).toBe(true);
  });

  it('thread with no running turns is not streaming', () => {
    const threadId = 'thread-x';
    const isStreaming = () =>
      useGlobalStore
        .getState()
        .agent.threads[threadId]?.turns.some((t) => t.status === 'running') ?? false;

    // Thread not yet created
    expect(isStreaming()).toBe(false);

    useGlobalStore.getState().startTurn(threadId, { id: 'turn-1', items: [], status: 'running' });
    expect(isStreaming()).toBe(true);

    useGlobalStore.getState().completeTurn(threadId, 'turn-1', 'completed');
    expect(isStreaming()).toBe(false);
  });
});

describe('global store - project management', () => {
  it('addProject adds to list', () => {
    const p = freshProject('p1', '/home/user/project-a');
    useGlobalStore.getState().addProject(p);
    expect(useGlobalStore.getState().workspace.projects).toHaveLength(1);
    expect(useGlobalStore.getState().workspace.projects[0].id).toBe('p1');
  });

  it('addProject does not duplicate by id', () => {
    const p = freshProject('p1', '/home/user/project-a');
    useGlobalStore.getState().addProject(p);
    useGlobalStore.getState().addProject(p);
    expect(useGlobalStore.getState().workspace.projects).toHaveLength(1);
  });

  it('removeProject removes from list', () => {
    useGlobalStore.getState().addProject(freshProject('p1', '/a'));
    useGlobalStore.getState().addProject(freshProject('p2', '/b'));
    useGlobalStore.getState().removeProject('p1');
    expect(useGlobalStore.getState().workspace.projects).toHaveLength(1);
    expect(useGlobalStore.getState().workspace.projects[0].id).toBe('p2');
  });

  it('switchProject updates currentProjectId, rootPath, and name', () => {
    useGlobalStore.getState().addProject(freshProject('p1', 'C:\\Users\\test\\alpha'));
    useGlobalStore.getState().addProject(freshProject('p2', 'D:\\beta'));

    useGlobalStore.getState().switchProject('p2');
    expect(useGlobalStore.getState().workspace.currentProjectId).toBe('p2');
    expect(useGlobalStore.getState().workspace.rootPath).toBe('d:/beta');
    expect(useGlobalStore.getState().workspace.name).toBe('beta');
  });

  it('switchProject normalizes Windows path', () => {
    useGlobalStore.getState().addProject(freshProject('p1', 'C:\\MyProject'));
    useGlobalStore.getState().switchProject('p1');
    expect(useGlobalStore.getState().workspace.rootPath).toBe('c:/MyProject');
  });

  it('switchProject is no-op for unknown id', () => {
    useGlobalStore.getState().addProject(freshProject('p1', 'C:\\ProjectA'));
    useGlobalStore.getState().switchProject('p1');
    useGlobalStore.getState().switchProject('nonexistent');
    expect(useGlobalStore.getState().workspace.currentProjectId).toBe('p1');
    expect(useGlobalStore.getState().workspace.rootPath).toBe('c:/ProjectA');
    expect(useGlobalStore.getState().workspace.name).toBe('ProjectA');
  });

  it('setProjects replaces entire list', () => {
    useGlobalStore.getState().setProjects([freshProject('p1', '/a'), freshProject('p2', '/b')]);
    expect(useGlobalStore.getState().workspace.projects).toHaveLength(2);
    useGlobalStore.getState().setProjects([freshProject('p3', '/c')]);
    expect(useGlobalStore.getState().workspace.projects).toHaveLength(1);
    expect(useGlobalStore.getState().workspace.projects[0].id).toBe('p3');
  });

  it('setCurrentProject updates only currentProjectId, not rootPath', () => {
    useGlobalStore.getState().setWorkspace('/some/path', 'some');
    useGlobalStore.getState().setCurrentProject('xyz');
    expect(useGlobalStore.getState().workspace.currentProjectId).toBe('xyz');
    expect(useGlobalStore.getState().workspace.rootPath).toBe('/some/path');
  });
});

describe('global store - token usage', () => {
  it('setThreadUsage stores usage by threadId', () => {
    useGlobalStore.getState().setThreadUsage('t1', { prompt: 1000, completion: 500, total: 1500 });
    expect(useGlobalStore.getState().agent.usageByThreadId['t1']).toEqual({
      prompt: 1000,
      completion: 500,
      total: 1500,
    });
  });

  it('setThreadUsage stores usage but does not update contextUsage', () => {
    useGlobalStore
      .getState()
      .setModels([{ id: 'm1', name: 'Model', provider: 'openai', context_window: 128000 }]);
    useGlobalStore.getState().setModel('m1');
    useGlobalStore.getState().setCurrentThread('t1');
    useGlobalStore.getState().setThreadUsage('t1', { prompt: 1000, completion: 500, total: 1500 });
    expect(useGlobalStore.getState().agent.usageByThreadId['t1']).toEqual({
      prompt: 1000,
      completion: 500,
      total: 1500,
    });
    // contextUsage is no longer updated by setThreadUsage
    expect(useGlobalStore.getState().agent.contextUsage).toBeNull();
  });

  it('setCurrentThread restores contextUsage from usageByThreadId', () => {
    useGlobalStore
      .getState()
      .setModels([{ id: 'm1', name: 'Model', provider: 'openai', context_window: 128000 }]);
    useGlobalStore.getState().setModel('m1');
    useGlobalStore.getState().setThreadUsage('t1', { prompt: 1000, completion: 500, total: 1500 });
    useGlobalStore.getState().setCurrentThread('t1');
    expect(useGlobalStore.getState().agent.contextUsage).toEqual({
      used: 1500,
      contextWindow: 128000,
    });
  });

  it('setCurrentThread clears contextUsage when no usage for thread', () => {
    useGlobalStore.getState().setContextUsage({ used: 100, contextWindow: 128000 });
    useGlobalStore.getState().setCurrentThread('t1');
    expect(useGlobalStore.getState().agent.contextUsage).toBeNull();
  });
});

describe('global store - compressing state', () => {
  it('initial isCompressing is false', () => {
    expect(useGlobalStore.getState().agent.isCompressing).toBe(false);
  });

  it('startCompressing sets isCompressing to true', () => {
    useGlobalStore.getState().startCompressing();
    expect(useGlobalStore.getState().agent.isCompressing).toBe(true);
  });

  it('stopCompressing sets isCompressing to false', () => {
    useGlobalStore.getState().startCompressing();
    expect(useGlobalStore.getState().agent.isCompressing).toBe(true);
    useGlobalStore.getState().stopCompressing();
    expect(useGlobalStore.getState().agent.isCompressing).toBe(false);
  });
});

describe('global store - loadThreads orphan data cleanup', () => {
  it('cleans up todoByThreadId for deleted threads', () => {
    useGlobalStore.getState().applyTodoUpdate('deleted-thread', [
      { id: '1', text: 'todo', status: 'in_progress' },
    ]);
    expect(useGlobalStore.getState().agent.todoByThreadId['deleted-thread']).toBeDefined();

    useGlobalStore.getState().loadThreads([]);
    expect(useGlobalStore.getState().agent.todoByThreadId['deleted-thread']).toBeUndefined();
  });

  it('preserves todoByThreadId for threads still in the list', () => {
    useGlobalStore.getState().applyTodoUpdate('kept-thread', [
      { id: '1', text: 'todo', status: 'in_progress' },
    ]);
    useGlobalStore.getState().loadThreads([
      { id: 'kept-thread', projectId: '', title: 'test', cwd: '/x', turns: [], createdAt: 1, updatedAt: 2 },
    ]);
    expect(useGlobalStore.getState().agent.todoByThreadId['kept-thread']).toBeDefined();
  });

  it('cleans up rollbackStateByThreadId for deleted threads', () => {
    useGlobalStore.getState().setRollbackState('deleted-thread', {
      context: { active: false, currentThroughTurnId: null },
      code: { canUndoLast: false, lastEntry: null, revertedFiles: [], lastEntryId: '' },
    } as any);
    useGlobalStore.getState().loadThreads([]);
    expect(useGlobalStore.getState().rollback.rollbackStateByThreadId['deleted-thread']).toBeUndefined();
  });

  it('cleans up checkpointDiffByTurnId for deleted threads', () => {
    useGlobalStore.getState().setCheckpointDiff('deleted-thread', '1', {
      turnId: 1, files: [],
    } as any);
    useGlobalStore.getState().loadThreads([]);
    expect(useGlobalStore.getState().rollback.checkpointDiffByTurnId['deleted-thread:1']).toBeUndefined();
  });

  it('cleans up revertedFilesByTurnId for deleted threads', () => {
    useGlobalStore.getState().markFileReverted('deleted-thread', '1', '/a.ts');
    useGlobalStore.getState().loadThreads([]);
    expect(useGlobalStore.getState().rollback.revertedFilesByTurnId['deleted-thread:1']).toBeUndefined();
  });

  it('cleans up turnCheckpointMapping for deleted threads', () => {
    useGlobalStore.getState().setTurnCheckpointMapping('deleted-thread', 1, 'ui-1');
    useGlobalStore.getState().loadThreads([]);
    expect(useGlobalStore.getState().rollback.turnCheckpointMapping['deleted-thread']).toBeUndefined();
  });

  it('preserves rollback data for threads still in the list', () => {
    useGlobalStore.getState().setRollbackState('kept-thread', {
      context: { active: false, currentThroughTurnId: null },
      code: { canUndoLast: false, lastEntry: null, revertedFiles: [], lastEntryId: '' },
    } as any);
    useGlobalStore.getState().setCheckpointDiff('kept-thread', '1', {
      turnId: 1, files: [],
    } as any);
    useGlobalStore.getState().markFileReverted('kept-thread', '1', '/a.ts');
    useGlobalStore.getState().setTurnCheckpointMapping('kept-thread', 1, 'ui-1');

    useGlobalStore.getState().loadThreads([
      { id: 'kept-thread', projectId: '', title: 'test', cwd: '/x', turns: [], createdAt: 1, updatedAt: 2 },
    ]);

    expect(useGlobalStore.getState().rollback.rollbackStateByThreadId['kept-thread']).toBeDefined();
    expect(useGlobalStore.getState().rollback.checkpointDiffByTurnId['kept-thread:1']).toBeDefined();
    expect(useGlobalStore.getState().rollback.revertedFilesByTurnId['kept-thread:1']).toBeDefined();
    expect(useGlobalStore.getState().rollback.turnCheckpointMapping['kept-thread']).toBeDefined();
  });
});
