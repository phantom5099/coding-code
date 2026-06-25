import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('http/direct sendMessage signature parity', () => {
  it('http.ts sendMessage accepts (input, cwd?)', () => {
    const src = readFileSync(
      'C:/Users/10116/Desktop/agent/coding code/packages/codingcode/src/client/http.ts',
      'utf8'
    );
    expect(src).toMatch(/sendMessage\(input: string, cwd\?: string\)/);
  });

  it('direct agent-runtime.ts exports AgentRuntimeClient with sendMessage', () => {
    const src = readFileSync(
      'C:/Users/10116/Desktop/agent/coding code/packages/codingcode/src/direct/agent-runtime.ts',
      'utf8'
    );
    expect(src).toMatch(/sendMessage\(input,/);
  });

  it('direct agent-runtime.ts no longer uses targetCwd rename', () => {
    const src = readFileSync(
      'C:/Users/10116/Desktop/agent/coding code/packages/codingcode/src/direct/agent-runtime.ts',
      'utf8'
    );
    expect(src).not.toMatch(/targetCwd/);
  });
});
