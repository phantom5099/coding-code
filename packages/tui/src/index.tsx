import React from 'react';
import { render } from 'ink';
import { App } from './components/App.js';
import { createDirectClient } from '@codingcode/core/client/direct';
import type { AgentClient, StreamChunk } from '@codingcode/core/client/types';

export type { AgentClient, StreamChunk };

interface TuiOptions {
  llm?: any;
  client?: AgentClient;
}

export async function runTui(options: TuiOptions = {}) {
  const client: AgentClient = options.client ?? (await createDirectClient(options.llm));
  render(<App client={client} />);
}
