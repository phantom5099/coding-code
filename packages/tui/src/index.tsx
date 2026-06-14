import React from 'react';
import { render } from 'ink';
import { App } from './components/App.js';
import { createDirectClient } from '@codingcode/core/client/direct';
import type { AgentClient, StreamChunk } from '@codingcode/core/client/types';

export type { AgentClient, StreamChunk };

type DirectClientParams = Parameters<typeof createDirectClient>;

interface TuiOptions {
  llm?: DirectClientParams[0];
  rt?: DirectClientParams[1];
  client?: AgentClient;
}

export async function runTui(options: TuiOptions = {}) {
  const client: AgentClient =
    options.client ?? (await createDirectClient(options.llm!, options.rt!));
  render(<App client={client} />);
}
