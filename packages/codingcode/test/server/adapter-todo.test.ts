import { describe, it, expect } from 'vitest';
import { formatEventForTransport } from '../../src/server/adapter.js';

describe('formatEventForTransport with TodoUpdate', () => {
  it('should serialize TodoUpdate as JSON string', () => {
    const result = formatEventForTransport({
      _tag: 'TodoUpdate',
      items: [
        { step: 'install deps', status: 'pending' },
        { step: 'write tests', status: 'completed' },
      ],
    } as any);

    expect(result).toBe(
      JSON.stringify({
        type: 'todo_update',
        items: [
          { step: 'install deps', status: 'pending' },
          { step: 'write tests', status: 'completed' },
        ],
      }),
    );
  });

  it('should handle empty items array', () => {
    const result = formatEventForTransport({
      _tag: 'TodoUpdate',
      items: [],
    } as any);

    expect(result).toBe(JSON.stringify({ type: 'todo_update', items: [] }));
  });

  it('should handle in_progress status', () => {
    const result = formatEventForTransport({
      _tag: 'TodoUpdate',
      items: [{ step: 'deploy', status: 'in_progress' }],
    } as any);

    expect(result).toBe(
      JSON.stringify({ type: 'todo_update', items: [{ step: 'deploy', status: 'in_progress' }] }),
    );
  });

  it('should return null for non-TodoUpdate events', () => {
    expect(formatEventForTransport({ _tag: 'Step', step: 1, max: 5 })).toBeNull();
    expect(formatEventForTransport({ _tag: 'LlmChunk', text: 'hi' })).toBe('hi');
  });
});
