import { describe, it, expect } from 'vitest'

// Tool-related logic used by the agent loop — pure unit tests

type StreamChunkType =
  | 'tool_start'
  | 'approval_request'
  | 'tool_result'
  | 'tool_denied'
  | 'error'
  | 'todo_update'
  | 'done'

interface ToolCallItem {
  id: string
  type: 'tool_call'
  name: string
  args: Record<string, unknown>
  status: 'pending' | 'running' | 'approved' | 'rejected'
}

interface ToolResultItem {
  id: string
  type: 'tool_result'
  callId: string
  output: string
  exitCode: number
}

interface ErrorItem {
  id: string
  type: 'error'
  message: string
}

type Item = ToolCallItem | ToolResultItem | ErrorItem

function randomId() {
  return Math.random().toString(36).slice(2, 11)
}

function processChunk(
  chunk: { type: StreamChunkType; [k: string]: any },
  items: Item[],
): Item | null {
  switch (chunk.type) {
    case 'tool_start': {
      const item: ToolCallItem = { id: randomId(), type: 'tool_call', name: chunk.name, args: chunk.args, status: 'running' }
      items.push(item)
      return item
    }
    case 'approval_request': {
      const item: ToolCallItem = { id: chunk.id, type: 'tool_call', name: chunk.tool, args: chunk.args, status: 'pending' }
      items.push(item)
      return item
    }
    case 'tool_result': {
      const tcIdx = items.findLastIndex((i) => i.type === 'tool_call' && (i as ToolCallItem).name === chunk.name)
      if (tcIdx >= 0) {
        const updated: ToolCallItem = { ...(items[tcIdx] as ToolCallItem), status: 'approved' }
        items[tcIdx] = updated
      }
      const resultItem: ToolResultItem = { id: randomId(), type: 'tool_result', callId: chunk.id, output: chunk.output, exitCode: chunk.ok ? 0 : 1 }
      items.push(resultItem)
      return resultItem
    }
    case 'tool_denied': {
      const tcIdx = items.findLastIndex((i) => i.type === 'tool_call' && (i as ToolCallItem).name === chunk.name)
      if (tcIdx >= 0) {
        const updated: ToolCallItem = { ...(items[tcIdx] as ToolCallItem), status: 'rejected' }
        items[tcIdx] = updated
      }
      return null
    }
    case 'error': {
      const item: ErrorItem = { id: randomId(), type: 'error', message: chunk.message }
      items.push(item)
      return item
    }
    default:
      return null
  }
}

describe('stream chunk processing', () => {
  it('tool_start creates a running tool_call item', () => {
    const items: Item[] = []
    const result = processChunk({ type: 'tool_start', name: 'read_file', args: { path: 'foo.ts' } }, items)

    expect(result?.type).toBe('tool_call')
    expect((result as ToolCallItem).status).toBe('running')
    expect((result as ToolCallItem).name).toBe('read_file')
  })

  it('approval_request uses the provided id for later matching', () => {
    const items: Item[] = []
    const result = processChunk({ type: 'approval_request', id: 'apr-xyz', tool: 'bash', args: { command: 'ls' } }, items)

    expect(result?.type).toBe('tool_call')
    expect(result?.id).toBe('apr-xyz')
    expect((result as ToolCallItem).status).toBe('pending')
  })

  it('tool_result creates a result item and marks matching call approved', () => {
    const items: Item[] = []
    processChunk({ type: 'approval_request', id: 'apr-1', tool: 'write_file', args: {} }, items)
    const result = processChunk({ type: 'tool_result', id: 'res-1', name: 'write_file', output: 'ok', ok: true }, items)

    expect(result?.type).toBe('tool_result')
    expect((result as ToolResultItem).exitCode).toBe(0)
    const call = items.find((i) => i.type === 'tool_call') as ToolCallItem
    expect(call.status).toBe('approved')
  })

  it('tool_result with ok=false sets exitCode to 1', () => {
    const items: Item[] = []
    processChunk({ type: 'tool_start', name: 'bash', args: {} }, items)
    const result = processChunk({ type: 'tool_result', id: 'res-2', name: 'bash', output: 'error', ok: false }, items)

    expect((result as ToolResultItem).exitCode).toBe(1)
  })

  it('tool_denied marks matching call as rejected', () => {
    const items: Item[] = []
    processChunk({ type: 'approval_request', id: 'apr-2', tool: 'edit_file', args: {} }, items)
    processChunk({ type: 'tool_denied', name: 'edit_file', reason: 'User denied' }, items)

    const call = items.find((i) => i.type === 'tool_call') as ToolCallItem
    expect(call.status).toBe('rejected')
  })

  it('error chunk produces an error item', () => {
    const items: Item[] = []
    const result = processChunk({ type: 'error', message: 'Something went wrong' }, items)

    expect(result?.type).toBe('error')
    expect((result as ErrorItem).message).toBe('Something went wrong')
  })

  it('done and todo_update chunks return null without mutating items', () => {
    const items: Item[] = []
    const r1 = processChunk({ type: 'done' }, items)
    const r2 = processChunk({ type: 'todo_update', items: [] }, items)
    expect(r1).toBeNull()
    expect(r2).toBeNull()
    expect(items).toHaveLength(0)
  })

  it('processes a complete tool execution sequence', () => {
    const items: Item[] = []
    processChunk({ type: 'approval_request', id: 'apr-seq', tool: 'bash', args: { command: 'echo hi' } }, items)
    processChunk({ type: 'tool_result', id: 'res-seq', name: 'bash', output: 'hi', ok: true }, items)

    expect(items).toHaveLength(2)
    expect((items[0] as ToolCallItem).status).toBe('approved')
    expect((items[1] as ToolResultItem).output).toBe('hi')
  })
})
