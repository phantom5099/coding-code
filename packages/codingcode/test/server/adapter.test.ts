import { describe, it, expect } from 'vitest';
import { formatEventForTransport, toSSEString } from '../../src/server/adapter.js';
import type { AgentEvent } from '../../src/agent/agent.js';
import { AgentError } from '../../src/core/error.js';

describe('formatEventForTransport', () => {
  it('extracts text from LlmChunk', () => {
    expect(formatEventForTransport({ _tag: 'LlmChunk', text: 'hello' })).toBe('hello');
  });

  it('formats ToolStart', () => {
    expect(formatEventForTransport({ _tag: 'ToolStart', name: 'readFile', args: {} }))
      .toBe('\n[Using: readFile]\n');
  });

  it('formats ToolDenied', () => {
    expect(formatEventForTransport({ _tag: 'ToolDenied', name: 'bash', reason: 'not allowed' }))
      .toBe('\n[Denied: bash] not allowed\n');
  });

  it('formats ApprovalRequest', () => {
    expect(formatEventForTransport({ _tag: 'ApprovalRequest', id: 'abc', tool: 'write_file', args: { path: '/tmp/x' } }))
      .toBe('\n[Approval: abc] write_file\n');
  });

  it('returns null for Step', () => {
    expect(formatEventForTransport({ _tag: 'Step', step: 1, max: 10 })).toBeNull();
  });

  it('returns null for Assistant', () => {
    expect(formatEventForTransport({ _tag: 'Assistant', content: 'ok' })).toBeNull();
  });

  it('returns null for ToolResult', () => {
    expect(formatEventForTransport({ _tag: 'ToolResult', id: 'x', name: 't', output: 'o', ok: true })).toBeNull();
  });

  it('returns null for Error', () => {
    expect(formatEventForTransport({ _tag: 'Error', error: AgentError.llmFailed('test') })).toBeNull();
  });

  it('returns null for Done', () => {
    expect(formatEventForTransport({ _tag: 'Done', content: 'done' })).toBeNull();
  });
});

describe('toSSEString', () => {
  it('converts AgentEvent generator to string stream, filtering null events', async () => {
    async function* source(): AsyncGenerator<AgentEvent, void, unknown> {
      yield { _tag: 'LlmChunk', text: 'Hello' };
      yield { _tag: 'Step', step: 1, max: 10 };
      yield { _tag: 'LlmChunk', text: ' world' };
      yield { _tag: 'Assistant', content: 'final' };
      yield { _tag: 'Done', content: 'final' };
    }
    const gen = toSSEString(source());
    const result: string[] = [];
    for await (const s of gen) result.push(s);
    expect(result).toEqual(['Hello', ' world']);
  });

  it('yields nothing when source has only non-visible events', async () => {
    async function* source(): AsyncGenerator<AgentEvent, void, unknown> {
      yield { _tag: 'Step', step: 1, max: 10 };
      yield { _tag: 'Done', content: 'x' };
    }
    const gen = toSSEString(source());
    const result: string[] = [];
    for await (const s of gen) result.push(s);
    expect(result).toEqual([]);
  });

  it('yields [Using:] for ToolStart', async () => {
    async function* source(): AsyncGenerator<AgentEvent, void, unknown> {
      yield { _tag: 'ToolStart', name: 'bash', args: { cmd: 'ls' } };
    }
    const gen = toSSEString(source());
    const result: string[] = [];
    for await (const s of gen) result.push(s);
    expect(result).toEqual(['\n[Using: bash]\n']);
  });
});
