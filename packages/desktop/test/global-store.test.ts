import { describe, it, expect, beforeEach } from 'vitest'
import { useGlobalStore } from '../src/stores/global.store'
import type { Item, Turn } from '../shared/types'

beforeEach(() => {
  useGlobalStore.setState({
    agent: {
      currentThreadId: null,
      threads: {},
      approvalPolicy: 'suggest',
      model: '',
      models: [],
      isStreaming: false,
      contextUsage: null,
      streamingContent: {},
    },
  })
})

describe('global store - agent streaming actions', () => {
  const threadId = 'thread-1'
  const turnId = 'turn-1'

  function makeTurn(items: Item[] = []): Turn {
    return { id: turnId, items, status: 'running' }
  }

  it('startTurn creates a thread if missing', () => {
    const turn = makeTurn([{ id: 'u1', type: 'message', role: 'user', content: 'hello' }])
    useGlobalStore.getState().startTurn(threadId, turn)

    const thread = useGlobalStore.getState().agent.threads[threadId]
    expect(thread).toBeDefined()
    expect(thread.turns).toHaveLength(1)
    expect(thread.turns[0].id).toBe(turnId)
    expect(useGlobalStore.getState().agent.isStreaming).toBe(true)
  })

  it('applyChunk adds streaming assistant item to turn.items and accumulates content', () => {
    const turn = makeTurn([])
    useGlobalStore.getState().startTurn(threadId, turn)

    const delta1: Item = { id: 'msg-1', type: 'message', role: 'assistant', content: 'Hello', partial: true }
    const delta2: Item = { id: 'msg-1', type: 'message', role: 'assistant', content: ' world', partial: true }
    useGlobalStore.getState().applyChunk(threadId, turnId, delta1)
    useGlobalStore.getState().applyChunk(threadId, turnId, delta2)

    const streaming = useGlobalStore.getState().agent.streamingContent['msg-1']
    expect(streaming).toBe('Hello world')

    // Streaming item is added to turn.items as a partial placeholder (added on first chunk)
    const items = useGlobalStore.getState().agent.threads[threadId].turns[0].items
    const placeholder = items.find((i) => i.id === 'msg-1')
    expect(placeholder).toBeDefined()
    expect((placeholder as any).partial).toBe(true)
    expect((placeholder as any).content).toBe('')
    // Not duplicated on subsequent chunks
    expect(items.filter((i) => i.id === 'msg-1')).toHaveLength(1)
  })

  it('applyChunk commits partial=false message to turn.items', () => {
    const turn = makeTurn([])
    useGlobalStore.getState().startTurn(threadId, turn)

    // Accumulate some text
    useGlobalStore.getState().applyChunk(threadId, turnId, {
      id: 'msg-1', type: 'message', role: 'assistant', content: 'Hello ', partial: true,
    })
    useGlobalStore.getState().applyChunk(threadId, turnId, {
      id: 'msg-1', type: 'message', role: 'assistant', content: 'world', partial: true,
    })

    // Commit
    useGlobalStore.getState().applyChunk(threadId, turnId, {
      id: 'msg-1', type: 'message', role: 'assistant', content: '', partial: false,
    })

    const items = useGlobalStore.getState().agent.threads[threadId].turns[0].items
    const committed = items.find((i) => i.id === 'msg-1')
    expect(committed).toBeDefined()
    expect((committed as any).content).toBe('Hello world')
    expect((committed as any).partial).toBe(false)
    expect(useGlobalStore.getState().agent.streamingContent['msg-1']).toBeUndefined()
  })

  it('applyChunk upserts tool_call by id', () => {
    const turn = makeTurn([])
    useGlobalStore.getState().startTurn(threadId, turn)

    const pending: Item = { id: 'call-1', type: 'tool_call', name: 'list_dir', args: {}, status: 'pending' }
    useGlobalStore.getState().applyChunk(threadId, turnId, pending)

    const running: Item = { id: 'call-1', type: 'tool_call', name: 'list_dir', args: {}, status: 'running' }
    useGlobalStore.getState().applyChunk(threadId, turnId, running)

    const items = useGlobalStore.getState().agent.threads[threadId].turns[0].items
    const toolItem = items.find((i) => i.id === 'call-1')
    expect(toolItem).toBeDefined()
    expect((toolItem as any).status).toBe('running')
    // Should have only one entry (upserted, not duplicated)
    expect(items.filter((i) => i.id === 'call-1')).toHaveLength(1)
  })

  it('completeTurn marks turn completed and clears streaming', () => {
    const turn = makeTurn([])
    useGlobalStore.getState().startTurn(threadId, turn)

    useGlobalStore.getState().applyChunk(threadId, turnId, {
      id: 'msg-x', type: 'message', role: 'assistant', content: 'hi', partial: true,
    })

    useGlobalStore.getState().completeTurn(threadId, turnId, 'completed')

    const updatedTurn = useGlobalStore.getState().agent.threads[threadId].turns[0]
    expect(updatedTurn.status).toBe('completed')
    expect(useGlobalStore.getState().agent.isStreaming).toBe(false)
  })
})

describe('global store - loadThreads', () => {
  const threadId = 'thread-1'
  const turnId = 'turn-1'

  function makeTurn(items: Item[] = []): Turn {
    return { id: turnId, items, status: 'running' }
  }

  function makeThread(turns: Turn[]): import('../shared/types').Thread {
    return { id: threadId, projectId: '', title: 'test', cwd: '/foo', turns, createdAt: 1000, updatedAt: 2000 }
  }

  it('preserves in-flight thread with running turn not yet persisted by backend', () => {
    const turn = makeTurn([{ id: 'u1', type: 'message', role: 'user', content: 'hello' }])
    useGlobalStore.getState().startTurn(threadId, turn)

    // Backend returns empty list (new thread not persisted yet)
    useGlobalStore.getState().loadThreads([])

    const thread = useGlobalStore.getState().agent.threads[threadId]
    expect(thread).toBeDefined()
    expect(thread.turns[0].status).toBe('running')
  })

  it('preserves in-memory turns when backend returns thread with empty turns', () => {
    const turn = makeTurn([{ id: 'u1', type: 'message', role: 'user', content: 'hello' }])
    useGlobalStore.getState().startTurn(threadId, turn)
    useGlobalStore.getState().completeTurn(threadId, turnId, 'completed')

    // Backend now returns threads with empty turns (history lives in codingcode session files)
    const backendThread = makeThread([])
    useGlobalStore.getState().loadThreads([backendThread])

    const thread = useGlobalStore.getState().agent.threads[threadId]
    // In-memory turns are preserved
    expect(thread.turns[0].items).toHaveLength(1)
    expect((thread.turns[0].items[0] as any).content).toBe('hello')
  })

  it('does not preserve completed thread absent from backend list', () => {
    const turn = makeTurn([])
    useGlobalStore.getState().startTurn(threadId, turn)
    useGlobalStore.getState().completeTurn(threadId, turnId, 'completed')

    useGlobalStore.getState().loadThreads([])

    expect(useGlobalStore.getState().agent.threads[threadId]).toBeUndefined()
  })
})
