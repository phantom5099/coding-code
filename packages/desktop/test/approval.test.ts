import { describe, it, expect } from 'vitest'

// Approval response parsing — mirrors parseApprovalResponse from core
function parseApprovalResponse(raw: string): { type: 'allow' | 'deny' } {
  switch (raw) {
    case 'allow': return { type: 'allow' }
    case 'deny': return { type: 'deny' }
    default: return { type: 'deny' }
  }
}

describe('approval response parsing', () => {
  it('parses allow as allow', () => {
    expect(parseApprovalResponse('allow')).toEqual({ type: 'allow' })
  })

  it('parses deny as deny', () => {
    expect(parseApprovalResponse('deny')).toEqual({ type: 'deny' })
  })

  it('parses unknown input as deny', () => {
    expect(parseApprovalResponse('y')).toEqual({ type: 'deny' })
    expect(parseApprovalResponse('n')).toEqual({ type: 'deny' })
    expect(parseApprovalResponse('')).toEqual({ type: 'deny' })
    expect(parseApprovalResponse('yes')).toEqual({ type: 'deny' })
  })
})

// Stream chunk approval_request handling — mirrors agent-loop's handleStructuredChunk
interface ToolCallItem {
  id: string
  type: 'tool_call'
  name: string
  args: Record<string, unknown>
  status: 'pending' | 'running' | 'approved' | 'rejected'
}

function handleApprovalRequestChunk(
  chunk: { id: string; tool: string; args: Record<string, unknown> },
  items: ToolCallItem[],
): ToolCallItem {
  const item: ToolCallItem = { id: chunk.id, type: 'tool_call', name: chunk.tool, args: chunk.args, status: 'pending' }
  items.push(item)
  return item
}

function handleToolResultChunk(
  chunk: { name: string; ok: boolean },
  items: ToolCallItem[],
): ToolCallItem | null {
  const idx = items.findLastIndex((i) => i.type === 'tool_call' && i.name === chunk.name)
  if (idx < 0) return null
  const updated: ToolCallItem = { ...items[idx], status: 'approved' }
  items[idx] = updated
  return updated
}

function handleToolDeniedChunk(
  chunk: { name: string },
  items: ToolCallItem[],
): ToolCallItem | null {
  const idx = items.findLastIndex((i) => i.type === 'tool_call' && i.name === chunk.name)
  if (idx < 0) return null
  const updated: ToolCallItem = { ...items[idx], status: 'rejected' }
  items[idx] = updated
  return updated
}

describe('stream chunk approval handling', () => {
  it('approval_request creates pending tool_call item with correct id', () => {
    const items: ToolCallItem[] = []
    const item = handleApprovalRequestChunk({ id: 'apr-123', tool: 'bash', args: { command: 'ls' } }, items)

    expect(item.status).toBe('pending')
    expect(item.id).toBe('apr-123')
    expect(item.name).toBe('bash')
    expect(items).toHaveLength(1)
  })

  it('tool_result updates matching tool_call status to approved', () => {
    const items: ToolCallItem[] = []
    handleApprovalRequestChunk({ id: 'apr-1', tool: 'bash', args: {} }, items)
    const updated = handleToolResultChunk({ name: 'bash', ok: true }, items)

    expect(updated?.status).toBe('approved')
    expect(items[0].status).toBe('approved')
  })

  it('tool_denied updates matching tool_call status to rejected', () => {
    const items: ToolCallItem[] = []
    handleApprovalRequestChunk({ id: 'apr-2', tool: 'read_file', args: {} }, items)
    const updated = handleToolDeniedChunk({ name: 'read_file' }, items)

    expect(updated?.status).toBe('rejected')
    expect(items[0].status).toBe('rejected')
  })

  it('tool_result returns null for unknown tool name', () => {
    const items: ToolCallItem[] = []
    const result = handleToolResultChunk({ name: 'nonexistent', ok: true }, items)
    expect(result).toBeNull()
  })

  it('multiple pending approvals: tool_denied resolves last matching', () => {
    const items: ToolCallItem[] = []
    handleApprovalRequestChunk({ id: 'apr-1', tool: 'bash', args: {} }, items)
    handleApprovalRequestChunk({ id: 'apr-2', tool: 'bash', args: {} }, items)

    handleToolDeniedChunk({ name: 'bash' }, items)

    // findLastIndex → only the last 'bash' entry is updated
    expect(items[0].status).toBe('pending')
    expect(items[1].status).toBe('rejected')
  })
})
