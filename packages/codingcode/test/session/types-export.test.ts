import { describe, expect, it } from 'vitest';
import type { SessionStoreState } from '../../src/contracts/session.js';

describe('SessionStoreState export', () => {
  it('contains only cwd as its path source', () => {
    const state: SessionStoreState = {
      type: 'session_meta',
      sessionId: 'test-sid',
      cwd: '/tmp',
      createdAt: '2026-01-01T00:00:00.000Z',
      model: 'gpt-4',
      title: '',
      activeProfile: 'build',
      permissionMode: 'ask',
      currentTurnId: 0,
      usage: undefined,
      memorySnapshot: '',
    };

    expect(state.cwd).toBe('/tmp');
    expect(state).not.toHaveProperty('projectPath');
    expect(state).not.toHaveProperty('transcriptPath');
    expect(state).not.toHaveProperty('indexPath');
    expect(state).not.toHaveProperty('mode');
  });
});
