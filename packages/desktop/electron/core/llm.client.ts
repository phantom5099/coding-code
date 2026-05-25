export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
  name?: string
}

export interface LLMTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

interface ToolCallAccumulator {
  id: string
  name: string
  args: string
}

export interface StreamCallbacks {
  onText: (delta: string) => void
  onToolCall: (call: { id: string; name: string; args: Record<string, unknown> }) => void
  onError: (err: string) => void
  onDone: () => void
}

export async function streamCompletion(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  messages: LLMMessage[],
  tools: LLMTool[] | undefined,
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const body: Record<string, unknown> = {
    model: modelId,
    messages,
    stream: true,
  }
  if (tools && tools.length > 0) {
    body.tools = tools
    body.tool_choice = 'auto'
  }

  let resp: Response
  try {
    resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') return
    callbacks.onError(String(err))
    return
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    callbacks.onError(`HTTP ${resp.status}: ${text}`)
    return
  }

  const reader = resp.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const toolCalls = new Map<number, ToolCallAccumulator>()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') {
          for (const [, tc] of toolCalls) {
            try {
              callbacks.onToolCall({ id: tc.id, name: tc.name, args: JSON.parse(tc.args || '{}') })
            } catch {
              callbacks.onToolCall({ id: tc.id, name: tc.name, args: {} })
            }
          }
          callbacks.onDone()
          return
        }
        try {
          const json = JSON.parse(data)
          const delta = json.choices?.[0]?.delta
          if (!delta) continue

          if (delta.content) callbacks.onText(delta.content)

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx: number = tc.index ?? 0
              if (!toolCalls.has(idx)) {
                toolCalls.set(idx, { id: '', name: '', args: '' })
              }
              const acc = toolCalls.get(idx)!
              if (tc.id) acc.id = tc.id
              if (tc.function?.name) acc.name += tc.function.name
              if (tc.function?.arguments) acc.args += tc.function.arguments
            }
          }
        } catch {
          // skip malformed chunk
        }
      }
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      callbacks.onError(String(err))
    }
    return
  }

  callbacks.onDone()
}
