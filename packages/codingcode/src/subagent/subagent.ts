import { Layer, Effect } from 'effect';
import { SubagentRunnerService } from './port.js';
import type { RunSubagentOptions } from './port.js';
import { AgentService } from '../agent/port.js';
import type { FrameBody } from '../sink/types.js';
import type { Result } from '../util/result.js';
import { BYPASS_PERMISSION_MODE } from '../util/enums.js';
import type { IncomingPart } from '../llm/types.js';

export const SubagentRunnerLayer = Layer.effect(
  SubagentRunnerService,
  Effect.gen(function* () {
    const agent = yield* AgentService;

    const runSubagent = (input: IncomingPart[], opts: RunSubagentOptions) =>
      Effect.gen(function* () {
        const result = yield* agent.runTurn(input, {
          sessionId: opts.sessionId,
          cwd: opts.cwd,
          signal: opts.signal,
          activeProfile: opts.activeProfile,
          // 子代理不经审批：调用点未给定时固定 bypass，避免继承父会话的审批链路
          permissionMode: opts.permissionMode ?? BYPASS_PERMISSION_MODE,
          model: opts.model,
          parentSessionId: opts.parentSessionId,
          agentName: opts.agentName,
          systemPrompt: opts.systemPrompt,
        });
        return {
          stream: result.stream as AsyncGenerator<FrameBody, Result<string, any>, unknown>,
          sessionId: result.sessionId,
        };
      });

    return { runSubagent };
  })
);
