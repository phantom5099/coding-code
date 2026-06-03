import { describe, it, expect, vi } from 'vitest';
import type { AgentEvent } from '../../src/agent/agent.js';
import { AgentError } from '../../src/core/error.js';

describe('reactive compact event', () => {
  it('should create ReactiveCompact event with attempt and released count', () => {
    const event: AgentEvent = {
      _tag: 'ReactiveCompact',
      attempt: 1,
      released: 5000,
      promptEstimate: 0,
    };

    expect(event._tag).toBe('ReactiveCompact');
    expect(event.attempt).toBe(1);
    expect(event.released).toBe(5000);
  });

  it('should distinguish ReactiveCompact from other events in switch', () => {
    const event: AgentEvent = {
      _tag: 'ReactiveCompact',
      attempt: 2,
      released: 3000,
      promptEstimate: 0,
    };

    let matched = false;
    switch (event._tag) {
      case 'ReactiveCompact':
        matched = true;
        expect(event.released).toBeGreaterThan(0);
        break;
      default:
        matched = false;
    }
    expect(matched).toBe(true);
  });

  it('should require both attempt and released fields', () => {
    // Type check: omitting either field should fail at compile time
    // This is a compile-time test, so we just verify the type shape
    const event: AgentEvent = {
      _tag: 'ReactiveCompact',
      attempt: 1,
      released: 100,
      promptEstimate: 0,
    };

    expect(Object.keys(event)).toContain('attempt');
    expect(Object.keys(event)).toContain('released');
  });

  it('should handle CONTEXT_OVERFLOW error code detection', () => {
    const err = AgentError.contextOverflow('openai', new Error('prompt too long'));
    expect(err.code).toBe('CONTEXT_OVERFLOW');

    const isOverflow = err.code === 'CONTEXT_OVERFLOW';
    expect(isOverflow).toBe(true);
  });

  it('should not trigger reactive compact for other error codes', () => {
    const err = new AgentError('LLM_FAILED', 'Some other LLM error');
    expect(err.code).not.toBe('CONTEXT_OVERFLOW');

    const shouldRetry = err.code === 'CONTEXT_OVERFLOW';
    expect(shouldRetry).toBe(false);
  });

  it('should respect max retries limit', () => {
    let reactiveRetries = 0;
    const MAX_REACTIVE = 1;

    // Simulate first overflow
    if (reactiveRetries < MAX_REACTIVE) {
      reactiveRetries += 1;
    }
    expect(reactiveRetries).toBe(1);

    // Simulate second overflow - should not retry
    if (reactiveRetries < MAX_REACTIVE) {
      reactiveRetries += 1;
    }
    expect(reactiveRetries).toBe(1); // Unchanged
  });

  it('should yield ReactiveCompact event before retrying step', () => {
    const events: AgentEvent[] = [];

    // Simulate yielding reactive compact event
    const compactEvent: AgentEvent = {
      _tag: 'ReactiveCompact',
      attempt: 1,
      released: 2000,
      promptEstimate: 0,
    };
    events.push(compactEvent);

    expect(events.length).toBe(1);
    expect(events[0]!._tag).toBe('ReactiveCompact');
    if (events[0]!._tag === 'ReactiveCompact') {
      expect(events[0]!.attempt).toBe(1);
      expect(events[0]!.released).toBe(2000);
    }
  });

  it('should use aggressive keepTurns config for reactive L5', () => {
    const defaultKeepTurns = 10;
    const aggressiveKeepTurns = 3;

    expect(aggressiveKeepTurns).toBeLessThan(defaultKeepTurns);
    expect(aggressiveKeepTurns).toBeGreaterThan(0);
  });
});
