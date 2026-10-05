/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from '../src/stores/agent.store';
import { createStreamState, reduceFrame } from '../src/lib/frame-reducer';
import type { StreamEffects } from '../src/lib/frame-reducer';
import type { Frame } from '@codingcode/sdk';

const THREAD = 'thread-1';
const TURN = 'turn-1';

// 副作用出口接到真实 store：覆盖 reduceFrame → applyChunk → items 的整条落库路径
function storeEffects(): StreamEffects {
  return {
    applyItem: (item) => useAgentStore.getState().applyChunk(THREAD, TURN, item),
    applyTodo: () => {},
    setUsage: () => {},
    setCompacted: () => {},
    syncTurnId: () => {},
    newId: () => 'id',
  };
}

function subagentFrame(seq: number, status: 'spawned' | 'completed' | 'failed'): Frame {
  return {
    sessionId: 's',
    turnId: 1,
    seq,
    family: 'event',
    event: { type: 'subagent_event', sessionId: 'child-1', agentName: 'build', status },
  } as Frame;
}

function items() {
  return useAgentStore.getState().threads[THREAD]!.turns[0]!.items;
}

function apply(...frames: Frame[]): void {
  const state = createStreamState('m1');
  const fx = storeEffects();
  for (const f of frames) reduceFrame(f, state, fx);
}

beforeEach(() => {
  useAgentStore.setState({
    currentThreadId: THREAD,
    threads: {
      [THREAD]: {
        id: THREAD,
        projectId: '',
        title: 't1',
        cwd: '/test/cwd',
        turns: [{ id: TURN, items: [], status: 'running' }],
        createdAt: 0,
        updatedAt: 0,
      },
    },
    profile: 'build',
    permissionMode: 'askBeforeExec',
    model: 'model-1',
    models: [],
    contextUsage: null,
    todoByThreadId: {},
    pendingInput: null,
    usageByThreadId: {},
    isCompressing: false,
    automations: [],
  } as any);
});

describe('subagent_event 帧 → 子代理列表（本地累加，不依赖服务端快照）', () => {
  it('spawned 建一条 running 条目，id 以子会话 id 为锚', () => {
    apply(subagentFrame(1, 'spawned'));
    expect(items()).toHaveLength(1);
    expect(items()[0]).toMatchObject({
      id: 'subagent:child-1',
      type: 'subagent',
      sessionId: 'child-1',
      agentName: 'build',
      status: 'running',
    });
  });

  it('completed 原地改状态，不新增条目', () => {
    apply(subagentFrame(1, 'spawned'), subagentFrame(2, 'completed'));
    expect(items()).toHaveLength(1);
    expect(items()[0]).toMatchObject({ status: 'completed' });
  });

  it('failed 原地改状态', () => {
    apply(subagentFrame(1, 'spawned'), subagentFrame(2, 'failed'));
    expect(items()).toHaveLength(1);
    expect(items()[0]).toMatchObject({ status: 'failed' });
  });

  it('多个子代理各自成条', () => {
    const other = {
      ...subagentFrame(1, 'spawned'),
      event: { type: 'subagent_event', sessionId: 'child-2', agentName: 'reviewer', status: 'spawned' },
    } as Frame;
    apply(subagentFrame(1, 'spawned'), other);
    expect(items().map((i) => i.id)).toEqual(['subagent:child-1', 'subagent:child-2']);
  });
});
