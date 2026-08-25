import { describe, expect, it } from 'vitest';
import type { SessionStoreState } from '../../src/session/types.js';

describe('SessionStoreState export', () => {
  it('contains only cwd as its path source', () => {
    const state: SessionStoreState = {
      sessionId: 'test-sid',
      cwd: '/tmp',
      messageCount: 0,
      sessionMeta: null,
      model: 'gpt-4',
      title: '',
      currentTurnId: 0,
      usage: undefined,
      activeProfile: 'build',
      permissionMode: 'default',
      memorySnapshot: '',
    };

    expect(state.cwd).toBe('/tmp');
    expect(state).not.toHaveProperty('projectPath');
    expect(state).not.toHaveProperty('transcriptPath');
    expect(state).not.toHaveProperty('indexPath');
    expect(state).not.toHaveProperty('mode');
  });
});
