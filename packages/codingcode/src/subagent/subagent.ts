import { Layer, Effect } from 'effect';
import { SubagentRunnerService } from './port.js';
import type { RunSubagentOptions } from './port.js';
import { AgentService } from '../agent/port.js';
import type { AgentEvent } from '../agent/types.js';
import type { Result } from '../core/result.js';

export const SubagentRunnerLayer = Layer.effect(
  SubagentRunnerService,
  Effect.gen(function* () {
    const agent = yield* AgentService;

    const runSubagent = (input: string, opts: RunSubagentOptions) =>
      Effect.gen(function* () {
        const result = yield* agent.runTurn(input, {
          sessionId: opts.sessionId,
          cwd: opts.cwd,
          signal: opts.signal,
          activeProfile: opts.activeProfile,
          permissionMode: opts.permissionMode,
          model: opts.model,
        });
        return {
          stream: result.stream as AsyncGenerator<AgentEvent, Result<string, any>, unknown>,
          sessionId: result.sessionId,
        };
      });

    return { runSubagent };
  })
);
