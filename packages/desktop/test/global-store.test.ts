import { describe, it, expect, beforeEach } from 'vitest'
import { useGlobalStore } from '../src/stores/global.store'
import type { Item, Turn, Project } from '../shared/types'

function freshProject(id: string, rootPath: string): Project {
  const name = rootPath.replace(/\\/g, '/').split('/').pop() || rootPath
  return { id, name, rootPath }
}

beforeEach(() => {
  useGlobalStore.setState({
    agent: {
      currentThreadId: null,
      threads: {},
      approvalPolicy: 'suggest',
      model: '',
      models: [],
      contextUsage: null,
      streamingContent: {},
    },
    workspace: {
      rootPath: '',
      name: '',
      projects: [],
      currentProjectId: '',
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
    expect(thread.turns.some((t) => t.status === 'running')).toBe(true)
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
    expect(updatedTurn.items.every((i) => useGlobalStore.getState().agent.streamingContent[i.id] === undefined)).toBe(true)
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

describe('global store - path normalization', () => {
  it('setWorkspace normalizes Windows backslash path', () => {
    useGlobalStore.getState().setWorkspace('C:\\Users\\10116\\Desktop', 'Desktop')
    expect(useGlobalStore.getState().workspace.rootPath).toBe('c:/Users/10116/Desktop')
    expect(useGlobalStore.getState().workspace.name).toBe('Desktop')
  })

  it('setWorkspace normalizes uppercase drive letter', () => {
    useGlobalStore.getState().setWorkspace('D:/Projects/foo', 'foo')
    expect(useGlobalStore.getState().workspace.rootPath).toBe('d:/Projects/foo')
  })

  it('setWorkspace leaves already-normalized path unchanged', () => {
    useGlobalStore.getState().setWorkspace('c:/users/foo', 'foo')
    expect(useGlobalStore.getState().workspace.rootPath).toBe('c:/users/foo')
  })

  it('startTurn normalizes cwd so it matches backend format', () => {
    const threadId = 'thread-norm'
    useGlobalStore.getState().startTurn(
      threadId,
      { id: 'turn-1', items: [], status: 'running' },
      { cwd: 'C:\\Users\\10116\\Desktop', title: 'test' },
    )
    expect(useGlobalStore.getState().agent.threads[threadId].cwd).toBe('c:/Users/10116/Desktop')
  })

  it('normalized workspace cwd and normalized thread cwd are equal → single group', () => {
    useGlobalStore.getState().setWorkspace('C:\\Users\\10116\\Desktop', 'Desktop')
    useGlobalStore.getState().startTurn(
      'thread-group',
      { id: 'turn-1', items: [], status: 'running' },
      { cwd: 'C:\\Users\\10116\\Desktop' },
    )
    const { rootPath } = useGlobalStore.getState().workspace
    const { cwd } = useGlobalStore.getState().agent.threads['thread-group']
    expect(cwd).toBe(rootPath)
  })
})

describe('global store - setThreadCwd', () => {
  it('updates cwd of an existing thread', () => {
    const threadId = 'thread-cwd'
    useGlobalStore.getState().startTurn(threadId, { id: 'turn-1', items: [], status: 'running' }, { cwd: '' })

    expect(useGlobalStore.getState().agent.threads[threadId].cwd).toBe('')

    useGlobalStore.getState().setThreadCwd(threadId, '/actual/path')

    expect(useGlobalStore.getState().agent.threads[threadId].cwd).toBe('/actual/path')
  })

  it('does nothing when thread does not exist', () => {
    expect(() => useGlobalStore.getState().setThreadCwd('nonexistent', '/path')).not.toThrow()
  })

  it('cwd updated by setThreadCwd survives a loadThreads call that preserves running threads', () => {
    const threadId = 'thread-cwd2'
    useGlobalStore.getState().startTurn(threadId, { id: 'turn-1', items: [], status: 'running' }, { cwd: '' })
    useGlobalStore.getState().setThreadCwd(threadId, '/actual/path')

    // Backend hasn't persisted the running thread yet — returns empty list
    useGlobalStore.getState().loadThreads([])

    expect(useGlobalStore.getState().agent.threads[threadId].cwd).toBe('/actual/path')
  })
})

describe('global store - per-thread isStreaming derivation', () => {
  it('thread A running does not affect thread B isStreaming', () => {
    const threadA = 'thread-a'
    const threadB = 'thread-b'

    useGlobalStore.getState().startTurn(threadA, { id: 'turn-a', items: [], status: 'running' })
    useGlobalStore.getState().startTurn(threadB, { id: 'turn-b', items: [], status: 'running' })

    const isStreamingA = () =>
      useGlobalStore.getState().agent.threads[threadA]?.turns.some((t) => t.status === 'running') ?? false
    const isStreamingB = () =>
      useGlobalStore.getState().agent.threads[threadB]?.turns.some((t) => t.status === 'running') ?? false

    expect(isStreamingA()).toBe(true)
    expect(isStreamingB()).toBe(true)

    useGlobalStore.getState().completeTurn(threadA, 'turn-a', 'completed')

    // Thread A done, Thread B still running
    expect(isStreamingA()).toBe(false)
    expect(isStreamingB()).toBe(true)
  })

  it('thread with no running turns is not streaming', () => {
    const threadId = 'thread-x'
    const isStreaming = () =>
      useGlobalStore.getState().agent.threads[threadId]?.turns.some((t) => t.status === 'running') ?? false

    // Thread not yet created
    expect(isStreaming()).toBe(false)

    useGlobalStore.getState().startTurn(threadId, { id: 'turn-1', items: [], status: 'running' })
    expect(isStreaming()).toBe(true)

    useGlobalStore.getState().completeTurn(threadId, 'turn-1', 'completed')
    expect(isStreaming()).toBe(false)
  })
})

describe('global store - project management', () => {
  it('addProject adds to list', () => {
    const p = freshProject('p1', '/home/user/project-a')
    useGlobalStore.getState().addProject(p)
    expect(useGlobalStore.getState().workspace.projects).toHaveLength(1)
    expect(useGlobalStore.getState().workspace.projects[0].id).toBe('p1')
  })

  it('addProject does not duplicate by id', () => {
    const p = freshProject('p1', '/home/user/project-a')
    useGlobalStore.getState().addProject(p)
    useGlobalStore.getState().addProject(p)
    expect(useGlobalStore.getState().workspace.projects).toHaveLength(1)
  })

  it('removeProject removes from list', () => {
    useGlobalStore.getState().addProject(freshProject('p1', '/a'))
    useGlobalStore.getState().addProject(freshProject('p2', '/b'))
    useGlobalStore.getState().removeProject('p1')
    expect(useGlobalStore.getState().workspace.projects).toHaveLength(1)
    expect(useGlobalStore.getState().workspace.projects[0].id).toBe('p2')
  })

  it('switchProject updates currentProjectId, rootPath, and name', () => {
    useGlobalStore.getState().addProject(freshProject('p1', 'C:\\Users\\test\\alpha'))
    useGlobalStore.getState().addProject(freshProject('p2', 'D:\\beta'))

    useGlobalStore.getState().switchProject('p2')
    expect(useGlobalStore.getState().workspace.currentProjectId).toBe('p2')
    expect(useGlobalStore.getState().workspace.rootPath).toBe('d:/beta')
    expect(useGlobalStore.getState().workspace.name).toBe('beta')
  })

  it('switchProject normalizes Windows path', () => {
    useGlobalStore.getState().addProject(freshProject('p1', 'C:\\MyProject'))
    useGlobalStore.getState().switchProject('p1')
    expect(useGlobalStore.getState().workspace.rootPath).toBe('c:/MyProject')
  })

  it('switchProject is no-op for unknown id', () => {
    useGlobalStore.getState().addProject(freshProject('p1', 'C:\\ProjectA'))
    useGlobalStore.getState().switchProject('p1')
    useGlobalStore.getState().switchProject('nonexistent')
    expect(useGlobalStore.getState().workspace.currentProjectId).toBe('p1')
    expect(useGlobalStore.getState().workspace.rootPath).toBe('c:/ProjectA')
    expect(useGlobalStore.getState().workspace.name).toBe('ProjectA')
  })

  it('setProjects replaces entire list', () => {
    useGlobalStore.getState().setProjects([freshProject('p1', '/a'), freshProject('p2', '/b')])
    expect(useGlobalStore.getState().workspace.projects).toHaveLength(2)
    useGlobalStore.getState().setProjects([freshProject('p3', '/c')])
    expect(useGlobalStore.getState().workspace.projects).toHaveLength(1)
    expect(useGlobalStore.getState().workspace.projects[0].id).toBe('p3')
  })

  it('setCurrentProject updates only currentProjectId, not rootPath', () => {
    useGlobalStore.getState().setWorkspace('/some/path', 'some')
    useGlobalStore.getState().setCurrentProject('xyz')
    expect(useGlobalStore.getState().workspace.currentProjectId).toBe('xyz')
    expect(useGlobalStore.getState().workspace.rootPath).toBe('/some/path')
  })
})
