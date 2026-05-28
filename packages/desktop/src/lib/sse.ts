/**
 * Generic SSE stream parser.
 * Reads a fetch Response body as an SSE stream and yields parsed `data:` JSON lines.
 */
export async function* parseSseStream(response: Response): AsyncGenerator<Record<string, unknown>, void, unknown> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        yield JSON.parse(line.slice(6)) as Record<string, unknown>
      }
    }
  } finally {
    reader.releaseLock()
  }
}
