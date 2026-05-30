import { describe, it, expect } from 'vitest'
import type { Item, Thread, Turn } from '../shared/types'

function extractPendingItems(thread: Thread | undefined): Array<Item & { type: 'tool_call' }> {
  return thread?.turns.flatMap((turn) =>
    turn.items.filter((i): i is Item & { type: 'tool_call' } => i.type === 'tool_call' && i.status === 'pending'),
  ) ?? []
}

function makeToolCall(name: string, status: 'pending' | 'running' | 'approved' | 'rejected', id?: string): Item {
  return { id: id ?? 'tc-' + name, type: 'tool_call', name, args: {}, status }
}

function makeMsg(role: 'user' | 'assistant', content: string): Item {
  return { id: 'm-' + content, type: 'message', role, content }
}

describe('extractPendingItems', () => {
  it('returns empty array when thread is undefined', () => {
    expect(extractPendingItems(undefined)).toHaveLength(0)
  })

  it('returns empty array when no pending tools exist', () => {
    const thread: Thread = {
      id: 'th-1',
      projectId: '',
      title: 'Test',
      cwd: '/tmp',
      turns: [
        { id: 't1', items: [makeMsg('user', 'hi'), makeToolCall('bash', 'approved')], status: 'completed' },
      ],
      createdAt: 0,
      updatedAt: 0,
    }
    expect(extractPendingItems(thread)).toHaveLength(0)
  })

  it('collects pending tools across multiple turns', () => {
    const thread: Thread = {
      id: 'th-1',
      projectId: '',
      title: 'Test',
      cwd: '/tmp',
      turns: [
        {
          id: 't1',
          items: [
            makeMsg('user', 'q1'),
            makeToolCall('bash', 'pending', 'tc-1'),
          ],
          status: 'running',
        },
        {
          id: 't2',
          items: [
            makeMsg('user', 'q2'),
            makeToolCall('read_file', 'pending', 'tc-2'),
            makeToolCall('write_file', 'pending', 'tc-3'),
          ],
          status: 'running',
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    }
    const pending = extractPendingItems(thread)
    expect(pending).toHaveLength(3)
    expect(pending[0]!.id).toBe('tc-1')
    expect(pending[1]!.id).toBe('tc-2')
    expect(pending[2]!.id).toBe('tc-3')
  })

  it('ignores non-pending tool statuses', () => {
    const thread: Thread = {
      id: 'th-1',
      projectId: '',
      title: 'Test',
      cwd: '/tmp',
      turns: [
        {
          id: 't1',
          items: [
            makeToolCall('bash', 'running', 'tc-1'),
            makeToolCall('read_file', 'approved', 'tc-2'),
            makeToolCall('write_file', 'rejected', 'tc-3'),
            makeToolCall('list_dir', 'pending', 'tc-4'),
          ],
          status: 'running',
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    }
    const pending = extractPendingItems(thread)
    expect(pending).toHaveLength(1)
    expect(pending[0]!.id).toBe('tc-4')
  })

  it('preserves order of pending tools within and across turns', () => {
    const thread: Thread = {
      id: 'th-1',
      projectId: '',
      title: 'Test',
      cwd: '/tmp',
      turns: [
        {
          id: 't1',
          items: [
            makeToolCall('a', 'pending', 'tc-a'),
            makeToolCall('b', 'running', 'tc-b'),
            makeToolCall('c', 'pending', 'tc-c'),
          ],
          status: 'running',
        },
        {
          id: 't2',
          items: [
            makeToolCall('d', 'pending', 'tc-d'),
            makeToolCall('e', 'approved', 'tc-e'),
          ],
          status: 'running',
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    }
    const pending = extractPendingItems(thread)
    expect(pending.map((i) => i.id)).toEqual(['tc-a', 'tc-c', 'tc-d'])
  })
})
