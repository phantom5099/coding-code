import React from 'react';
import { render } from 'ink';
import { App } from './components/App.js';
import { createDirectClient } from '@codingcode/core/client/direct';
import type { AgentClient, StreamChunk } from '@codingcode/core/client/types';
import type { ManagedRuntime } from 'effect';

export type { AgentClient, StreamChunk };

interface TuiOptions {
  llm?: any;
  rt?: ManagedRuntime.ManagedRuntime<any, any>;
  client?: AgentClient;
}

export async function runTui(options: TuiOptions = {}) {
  const client: AgentClient =
    options.client ?? (await createDirectClient(options.llm, options.rt!));
  render(<App client={client} />);
}
