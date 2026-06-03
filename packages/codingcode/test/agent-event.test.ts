import { describe, it, expect } from 'vitest';
import type { AgentEvent } from '../src/agent/agent.js';

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
    const ev: AgentEvent = {
      _tag: 'Error',
      error: { _tag: 'MaxStepsReached', maxSteps: 5, message: 'test' },
    };
    switch (ev._tag) {
      case 'Error':
        expect(ev.error._tag).toBe('MaxStepsReached');
        break;
      default:
        // Should not reach here for this test
        break;
    }
  });

  it('should be importable from the public index', async () => {
    const mod = await import('../src/index.js');
    // The type is erased at runtime, but we verify the module loads without error
    expect(mod).toBeDefined();
  }, 10000);
});
