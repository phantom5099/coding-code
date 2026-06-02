import { describe, it, expect } from 'vitest';
import { agentEventToSseEvent } from '../../src/server/adapter.js';

describe('agentEventToSseEvent with TodoUpdate', () => {
  it('should serialize TodoUpdate as structured object', () => {
    const items = [
      { step: 'install deps', status: 'pending' as const },
      { step: 'write tests', status: 'completed' as const },
    ];
    const result = agentEventToSseEvent({
      _tag: 'TodoUpdate',
      items,
    });

    expect(result).toEqual({
      type: 'todo_update',
      items,
    });
  });

  it('should handle empty items array', () => {
    const result = agentEventToSseEvent({
      _tag: 'TodoUpdate',
      items: [],
    });

    expect(result).toEqual({ type: 'todo_update', items: [] });
  });

  it('should handle in_progress status', () => {
    const result = agentEventToSseEvent({
      _tag: 'TodoUpdate',
      items: [{ step: 'deploy', status: 'in_progress' }],
    });

    expect(result).toEqual({
      type: 'todo_update',
      items: [{ step: 'deploy', status: 'in_progress' }],
    });
  });

  it('should return structured event for Step, null for LlmChunk (handled by toSseEvents)', () => {
    expect(agentEventToSseEvent({ _tag: 'Step', step: 1, max: 5 })).toEqual({ type: 'step', step: 1 });
    expect(agentEventToSseEvent({ _tag: 'LlmChunk', text: 'hi' })).toBeNull();
  });
});
