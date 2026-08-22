import React from 'react';
import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/hooks/useAgentRunner.js', () => ({
  useAgentRunner: () => ({
    staticMessages: [],
    activeMessages: [],
    setStaticMessages: vi.fn(),
    setActiveMessages: vi.fn(),
    run: vi.fn(),
    isRunning: false,
    approval: null,
    setApproval: vi.fn(),
  }),
}));

vi.mock('../../src/hooks/useTerminalSize.js', () => ({
  useTerminalSize: () => ({ width: 80, height: 24 }),
}));

vi.mock('../../src/components/MessageItem.js', () => ({
  MessageItem: () => null,
}));
vi.mock('../../src/components/InputBox.js', () => ({
  InputBox: () => null,
}));
vi.mock('../../src/components/LoadingIndicator.js', () => ({
  LoadingIndicator: () => null,
}));
vi.mock('../../src/components/InlinePanel.js', () => ({
  InlinePanel: () => null,
}));

import { App } from '../../src/components/App.js';

const client = {
  sendMessage: vi.fn(),
  sendApprovalResponse: vi.fn(),
  getSessionId: vi.fn(() => 'test-session'),
  compact: vi.fn(),
  setMemoryEnabled: vi.fn(),
  getMemoryEnabled: vi.fn(),
  listModels: vi.fn(),
  switchModel: vi.fn(),
  listSessions: vi.fn(),
  getMcpStatus: vi.fn(),
  setMcpDisabled: vi.fn(),
  listSkills: vi.fn(),
  toggleSkill: vi.fn(),
  getPermissionMode: vi.fn(),
  setPermissionMode: vi.fn(),
  resumeSession: vi.fn(),
};

describe('App', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders JSX without requiring a missing React runtime binding', () => {
    const instance = render(<App client={client} />);

    expect(instance.lastFrame()).toBeDefined();
    instance.unmount();
  });
});
