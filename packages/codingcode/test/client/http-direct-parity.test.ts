import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('http/direct sendMessage signature parity', () => {
  it('http.ts sendMessage accepts (input, cwd?)', () => {
    const src = readFileSync(new URL('../../src/client/http.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/sendMessage\(input: string, cwd\?: string\)/);
  });

  it('direct agent-runtime.ts exports AgentRuntimeClient with sendMessage', () => {
    const src = readFileSync(new URL('../../src/direct/agent-runtime.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/sendMessage\(input,/);
  });

  it('direct agent-runtime.ts no longer uses targetCwd rename', () => {
    const src = readFileSync(new URL('../../src/direct/agent-runtime.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/targetCwd/);
  });
});
