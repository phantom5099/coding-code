import { describe, it, expect } from 'vitest'
import type { Item, Turn } from '../shared/types'

function buildRenderEntries(turns: Turn[]) {
  const renderEntries: Array<{ item: Item; turnId: string; toolResult?: Item & { type: 'tool_result' } }> = []
  const toolResultByCallId: Record<string, Item & { type: 'tool_result' }> = {}

  for (const turn of turns) {
    for (const item of turn.items) {
      if (item.type === 'tool_result') {
        toolResultByCallId[item.callId] = item as any
      }
    }
  }

  for (const turn of turns) {
    for (const item of turn.items) {
      if (item.type === 'tool_result') {
        continue
      }
      if (item.type === 'tool_call') {
        renderEntries.push({ item, turnId: turn.id, toolResult: toolResultByCallId[item.id] })
      } else {
        renderEntries.push({ item, turnId: turn.id })
      }
    }
  }
  return renderEntries
}

function makeMsg(role: 'user' | 'assistant', content: string): Item {
  return { id: 'm-' + content, type: 'message', role, content }
}

function makeToolCall(name: string, status: 'pending' | 'running' | 'approved' | 'rejected', id?: string): Item {
  return { id: id ?? 'tc-' + name, type: 'tool_call', name, args: {}, status }
}

function makeToolResult(callId: string, output?: string): Item {
  return { id: 'tr-' + callId, type: 'tool_result', callId, output: output ?? 'ok' }
}

describe('buildRenderEntries merges tool_call + tool_result globally', () => {
  it('merges a tool_call with matching tool_result even when not adjacent', () => {
    const turns: Turn[] = [
      {
        id: 't1',
        items: [
          makeMsg('user', 'hello'),
          makeToolCall('bash', 'approved', 'tc-1'),
          makeMsg('assistant', 'text'),
          makeToolResult('tc-1', 'hi'),
        ],
        status: 'completed',
      },
    ]
    const entries = buildRenderEntries(turns)
    expect(entries).toHaveLength(3)
    expect(entries[0]!.item.type).toBe('message')
    expect(entries[1]!.item.type).toBe('tool_call')
    expect(entries[1]!.toolResult).toBeDefined()
    expect((entries[1]!.toolResult as any).output).toBe('hi')
    expect(entries[2]!.item.type).toBe('message')
  })

  it('looks up tool_result across turns', () => {
    const turns: Turn[] = [
      {
        id: 't1',
        items: [makeToolCall('bash', 'approved', 'tc-1')],
        status: 'completed',
      },
      {
        id: 't2',
        items: [makeToolResult('tc-1', 'hi')],
        status: 'completed',
      },
    ]
    const entries = buildRenderEntries(turns)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.item.type).toBe('tool_call')
    expect(entries[0]!.toolResult).toBeDefined()
    expect((entries[0]!.toolResult as any).output).toBe('hi')
  })

  it('renders running tool_call without toolResult', () => {
    const turns: Turn[] = [
      {
        id: 't1',
        items: [
          makeMsg('user', 'q'),
          makeToolCall('bash', 'running', 'tc-1'),
        ],
        status: 'running',
      },
    ]
    const entries = buildRenderEntries(turns)
    expect(entries).toHaveLength(2)
    expect(entries[1]!.item.id).toBe('tc-1')
    expect(entries[1]!.toolResult).toBeUndefined()
  })

  it('does not render tool_result as standalone entry', () => {
    const turns: Turn[] = [
      {
        id: 't1',
        items: [
          makeToolCall('bash', 'approved', 'tc-1'),
          makeToolResult('tc-1', 'ok'),
        ],
        status: 'completed',
      },
    ]
    const entries = buildRenderEntries(turns)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.item.type).toBe('tool_call')
    expect(entries[0]!.toolResult).toBeDefined()
  })

  it('handles empty turns', () => {
    const entries = buildRenderEntries([])
    expect(entries).toHaveLength(0)
  })

  it('handles turns with only messages', () => {
    const turns: Turn[] = [
      { id: 't1', items: [makeMsg('user', 'hi'), makeMsg('assistant', 'hello')], status: 'completed' },
    ]
    const entries = buildRenderEntries(turns)
    expect(entries).toHaveLength(2)
    expect(entries.every((e) => e.toolResult === undefined)).toBe(true)
  })

  it('unified tool_call has toolResult after approval_request', () => {
    // Simulates: tool_start(running, id='old') then approval_request modifies id to 'new'
    const turns: Turn[] = [
      {
        id: 't1',
        items: [
          makeToolCall('write_file', 'pending', 'tc-new'),
          makeToolResult('tc-new', 'done'),
        ],
        status: 'running',
      },
    ]
    const entries = buildRenderEntries(turns)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.item.id).toBe('tc-new')
    expect(entries[0]!.toolResult).toBeDefined()
    expect((entries[0]!.toolResult as any).output).toBe('done')
  })
})
