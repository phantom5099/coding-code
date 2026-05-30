import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { StreamEvent } from '../src/lib/agent-stream'

function parseSSELines(rawSSE: string): StreamEvent[] {
  const events: StreamEvent[] = []
  const lines = rawSSE.split('\n')
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = JSON.parse(line.slice(6))
      events.push(data as StreamEvent)
    }
  }
  return events
}

describe('SSE event parser', () => {
  it('parses session_id event', () => {
    const events = parseSSELines('data: {"type":"session_id","sessionId":"sess-1"}\n\n')
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: 'session_id', sessionId: 'sess-1' })
  })

  it('parses step event', () => {
    const events = parseSSELines('data: {"type":"step","step":3}\n\n')
    expect(events).toEqual([{ type: 'step', step: 3 }])
  })

  it('parses text event with messageId', () => {
    const events = parseSSELines('data: {"type":"text","text":"Hello","messageId":1}\n\n')
    expect(events).toEqual([{ type: 'text', text: 'Hello', messageId: 1 }])
  })

  it('parses tool_start event', () => {
    const events = parseSSELines('data: {"type":"tool_start","id":"tc-1","name":"readFile","args":{"path":"/tmp/x"}}\n\n')
    expect(events[0]).toEqual({ type: 'tool_start', id: 'tc-1', name: 'readFile', args: { path: '/tmp/x' } })
  })

  it('parses tool_result event', () => {
    const events = parseSSELines('data: {"type":"tool_result","id":"tc1","name":"bash","output":"ok","ok":true}\n\n')
    expect(events[0]).toEqual({ type: 'tool_result', id: 'tc1', name: 'bash', output: 'ok', ok: true })
  })

  it('parses tool_denied event', () => {
    const events = parseSSELines('data: {"type":"tool_denied","id":"tc-1","name":"bash","reason":"blocked"}\n\n')
    expect(events[0]).toEqual({ type: 'tool_denied', id: 'tc-1', name: 'bash', reason: 'blocked' })
  })

  it('parses approval_request event', () => {
    const events = parseSSELines('data: {"type":"approval_request","id":"r1","tool":"write","args":{"path":"/f"}}\n\n')
    expect(events[0]).toEqual({ type: 'approval_request', id: 'r1', tool: 'write', args: { path: '/f' } })
  })

  it('parses todo_update event', () => {
    const items = [{ step: 'test', status: 'completed' }]
    const line = `data: ${JSON.stringify({ type: 'todo_update', items })}\n\n`
    const events = parseSSELines(line)
    expect(events[0]).toEqual({ type: 'todo_update', items })
  })

  it('parses error event', () => {
    const events = parseSSELines('data: {"type":"error","message":"boom"}\n\n')
    expect(events[0]).toEqual({ type: 'error', message: 'boom' })
  })

  it('parses done event', () => {
    const events = parseSSELines('data: {"type":"done"}\n\n')
    expect(events[0]).toEqual({ type: 'done' })
  })

  it('parses complete event', () => {
    const events = parseSSELines('data: {"type":"complete"}\n\n')
    expect(events[0]).toEqual({ type: 'complete' })
  })

  it('parses multiple events in a single stream', () => {
    const raw = [
      'data: {"type":"session_id","sessionId":"sess-1"}',
      '',
      'data: {"type":"step","step":1}',
      '',
      'data: {"type":"text","text":"Hello","messageId":1}',
      '',
      'data: {"type":"tool_start","name":"read","args":{}}',
      '',
      'data: {"type":"tool_result","id":"t1","name":"read","output":"data","ok":true}',
      '',
      'data: {"type":"done"}',
      '',
      'data: {"type":"complete"}',
      '',
    ].join('\n')
    const events = parseSSELines(raw)
    expect(events).toHaveLength(7)
    expect(events[0].type).toBe('session_id')
    expect(events[1].type).toBe('step')
    expect(events[2].type).toBe('text')
    expect(events[3].type).toBe('tool_start')
    expect(events[4].type).toBe('tool_result')
    expect(events[5].type).toBe('done')
    expect(events[6].type).toBe('complete')
  })

  it('ignores non-data lines', () => {
    const raw = [
      'event: ping',
      'data: {"type":"text","text":"data","messageId":0}',
      ': comment line',
      '',
    ].join('\n')
    const events = parseSSELines(raw)
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: 'text', text: 'data', messageId: 0 })
  })
})
