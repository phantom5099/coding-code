// HTTP + SSE → AsyncGenerator<string>
export class CodingCodeClient {
  constructor(private baseUrl: string) {}

  async *sendMessage(sessionId: string, input: string): AsyncGenerator<string> {
    const response = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ input }),
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6));
          if (data.type === 'text') {
            yield data.text;
          } else if (data.type === 'complete') {
            return;
          } else if (data.type === 'error') {
            throw new Error(data.message);
          }
        }
      }
    }
  }
}
