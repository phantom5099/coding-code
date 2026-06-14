import { Effect } from 'effect';
import type { AgentEvent } from '../agent/types.js';
import type { AgentError } from '../core/error.js';
import type { Result } from '../core/result.js';
import type { RunStreamOptions } from '../agent/types.js';

export interface SubagentRunner {
  runStream(
    opts: RunStreamOptions
  ): AsyncGenerator<AgentEvent, Result<string, AgentError>, unknown>;
}

export class SubagentRunnerService extends Effect.Service<SubagentRunnerService>()(
  'SubagentRunner',
  {
    effect: Effect.gen(function* () {
      // Placeholder — the real implementation is provided by AgentService's Layer
      return {} as SubagentRunner;
    }),
  }
) {}
