import { describe, it, expect } from 'vitest';
import type { SessionStoreState } from '../../src/session/types.js';

describe('SessionStoreState export', () => {
  it('should be importable from session/types', () => {
    const state: SessionStoreState = {
      sessionId: 'test-sid',
      cwd: '/tmp',
      projectPath: 'proj',
      transcriptPath: '/tmp/proj/sessions/test.jsonl',
      indexPath: '/tmp/proj/sessions/test.index.json',
      messageCount: 0,
      sessionMeta: null,
      model: 'gpt-4',
      title: '',
      currentTurnId: 0,
      usage: undefined,
      mode: 'build',
      permissionMode: 'default',
      memorySnapshot: '',
    };
    expect(state.sessionId).toBe('test-sid');
    expect(state.messageCount).toBe(0);
  });
});
