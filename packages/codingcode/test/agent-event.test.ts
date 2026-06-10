import { describe, it, expect } from 'vitest';
import type { AgentEvent } from '../src/agent/agent.js';
import { AgentError } from '../src/core/error.js';

describe('AgentEvent type', () => {
  it('should accept an LlmChunk event', () => {
    const ev: AgentEvent = { _tag: 'LlmChunk', text: 'hello' };
    expect(ev._tag).toBe('LlmChunk');
    if (ev._tag === 'LlmChunk') expect(ev.text).toBe('hello');
  });

  it('should accept a Done event', () => {
    const ev: AgentEvent = { _tag: 'Done', content: 'result' };
    expect(ev._tag).toBe('Done');
    if (ev._tag === 'Done') expect(ev.content).toBe('result');
  });

  it('should accept a Usage event', () => {
    const ev: AgentEvent = { _tag: 'Usage', prompt: 1000, completion: 500, total: 1500 };
    expect(ev._tag).toBe('Usage');
    if (ev._tag === 'Usage') {
      expect(ev.prompt).toBe(1000);
      expect(ev.completion).toBe(500);
      expect(ev.total).toBe(1500);
    }
  });

  it('should narrow correctly via discriminated union switch', () => {
    const err = AgentError.maxStepsReached(5);
    const ev: AgentEvent = {
      _tag: 'Error',
      error: err,
    };
    switch (ev._tag) {
      case 'Error':
        expect(ev.error).toBeInstanceOf(AgentError);
        break;
      default:
        // Should not reach here for this test
        break;
    }
  });
});
