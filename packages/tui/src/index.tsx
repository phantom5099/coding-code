import React from 'react';
import { render } from 'ink';
import { App } from './components/App.js';

interface TuiOptions {
  serverUrl?: string;
}

export function runTui(options: TuiOptions = {}) {
  const serverUrl = options.serverUrl ?? 'http://localhost:8080';
  let currentSessionId: string | undefined;

  const client = {
    async *sendMessage(input: string): AsyncGenerator<string> {
      if (!currentSessionId) {
        const createRes = await fetch(`${serverUrl}/api/sessions`, {
          method: 'POST',
          body: JSON.stringify({ cwd: process.cwd() }),
          headers: { 'Content-Type': 'application/json' },
        });
        if (!createRes.ok) throw new Error(`HTTP ${createRes.status}`);
        const { sessionId } = await createRes.json() as { sessionId: string };
        currentSessionId = sessionId;
      }

      const response = await fetch(`${serverUrl}/api/sessions/${currentSessionId}/messages`, {
        method: 'POST', body: JSON.stringify({ input }),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No body');
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
            if (data.type === 'text') yield data.text;
            else if (data.type === 'complete') return;
            else if (data.type === 'error') throw new Error(data.message);
          }
        }
      }
    },

    async resumeSession(sid: string) {
      currentSessionId = sid;
      const res = await fetch(`${serverUrl}/api/sessions/${sid}/resume`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd: process.cwd() }) });
      return res.json();
    },
    async listSessions(): Promise<any[]> { const res = await fetch(`${serverUrl}/api/sessions`); return res.json() as Promise<any[]>; },
    async listModels() { const res = await fetch(`${serverUrl}/api/models`); return res.json(); },
    async switchModel(id: string) { await fetch(`${serverUrl}/api/models/switch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelId: id }) }); },
    async listRoles() { const res = await fetch(`${serverUrl}/api/roles`); return res.json(); },
    async switchRole(id: string) { await fetch(`${serverUrl}/api/roles/switch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: id }) }); },
    getSessionId() { return currentSessionId ?? 'unknown'; },
    async clearSession() {},
  };

  const { waitUntilExit } = render(<App client={client} />);

  process.on('SIGINT', () => { process.exit(0); });
  process.on('SIGTERM', () => { process.exit(0); });

  return { waitUntilExit };
}
