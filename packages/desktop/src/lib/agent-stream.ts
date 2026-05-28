import { API_BASE } from './api'

export type StreamEvent =
  | { type: 'session_id'; sessionId: string }
  | { type: 'step'; step: number }
  | { type: 'text'; text: string; messageId: number }
  | { type: 'approval_request'; id: string; tool: string; args: Record<string, unknown> }
  | { type: 'tool_start'; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; output: string; ok: boolean }
  | { type: 'tool_denied'; name: string; reason: string }
  | { type: 'todo_update'; items: Array<{ step: string; status: 'pending' | 'in_progress' | 'completed' }> }
  | { type: 'error'; message: string }
  | { type: 'done' }
  | { type: 'complete' }

export interface StreamResult {
  sessionId: string
  done: boolean
  error?: string
}

export async function* streamAgentMessage(
  input: string,
  cwd: string,
  sessionId?: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent, StreamResult, unknown> {
  const response = await fetch(
    `${API_BASE}/api/sessions/${sessionId || '_'}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input, cwd }),
      signal,
    },
  )

  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''
  let resolvedSessionId = sessionId ?? ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue

        const data = JSON.parse(line.slice(6))
        switch (data.type) {
          case 'session_id':
            resolvedSessionId = data.sessionId as string
            yield { type: 'session_id', sessionId: resolvedSessionId }
            break
          case 'step':
            yield { type: 'step', step: data.step as number }
            break
          case 'text':
            yield { type: 'text', text: data.text as string, messageId: data.messageId as number }
            break
          case 'approval_request':
            yield { type: 'approval_request', id: data.id as string, tool: data.tool as string, args: data.args as Record<string, unknown> }
            break
          case 'tool_start':
            yield { type: 'tool_start', name: data.name as string, args: data.args as Record<string, unknown> }
            break
          case 'tool_result':
            yield { type: 'tool_result', id: data.id as string, name: data.name as string, output: data.output as string, ok: data.ok as boolean }
            break
          case 'tool_denied':
            yield { type: 'tool_denied', name: data.name as string, reason: data.reason as string }
            break
          case 'todo_update':
            yield { type: 'todo_update', items: data.items as Array<{ step: string; status: 'pending' | 'in_progress' | 'completed' }> }
            break
          case 'error':
            yield { type: 'error', message: data.message as string }
            return { sessionId: resolvedSessionId, done: false, error: data.message as string }
          case 'done':
            yield { type: 'done' }
            break
          case 'complete':
            return { sessionId: resolvedSessionId, done: true }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  return { sessionId: resolvedSessionId, done: true }
}
