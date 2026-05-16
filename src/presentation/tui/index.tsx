import React from 'react';
import { render } from 'ink';
import { App } from './components/App';
import type { Agent } from '../../agent/agent';
import type { SessionStore } from '../../session/store';

export function runTui(agent: Agent, sessionStore: SessionStore) {
  const app = render(<App agent={agent} sessionStore={sessionStore} />);

  process.on('SIGINT', () => {
    app.unmount();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    app.unmount();
    process.exit(0);
  });
}
