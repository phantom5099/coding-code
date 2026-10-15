import { Layer, Effect } from 'effect';
import { SubagentRunnerService } from './port.js';
import type { RunSubagentOptions } from './port.js';
import { AgentService } from '../agent/port.js';
import type { FrameBody } from '../sink/types.js';
import { AgentError } from '../util/error.js';
import type { Result } from '../util/result.js';
import { BYPASS_PERMISSION_MODE } from '../util/enums.js';
import type { IncomingPart } from '../llm/types.js';
import { transcriptPathOf } from '../session/paths.js';
import { readSessionMeta } from '../session/file-ops.js';

export const SubagentRunnerLayer = Layer.effect(
  SubagentRunnerService,
  Effect.gen(function* () {
    const agent = yield* AgentService;

    /** 续跑：systemPrompt 由会话头承载，从盘上回读，调用方与模型都无需重述 */
    const resolveSystemPrompt = (opts: RunSubagentOptions): string | undefined => {
      if (!opts.sessionId) return opts.systemPrompt;
      const meta = readSessionMeta(
        transcriptPathOf(opts.cwd, opts.sessionId, opts.parentSessionId)
      );
      return meta?.systemPrompt;
    };

    const runSubagent = (input: IncomingPart[], opts: RunSubagentOptions) =>
      Effect.gen(function* () {
        const result = yield* agent.runTurn(input, {
          sessionId: opts.sessionId,
          cwd: opts.cwd,
          activeProfile: opts.activeProfile,
          // 子代理不经审批：调用点未给定时固定 bypass，避免继承父会话的审批链路
          permissionMode: opts.permissionMode ?? BYPASS_PERMISSION_MODE,
          model: opts.model,
          parentSessionId: opts.parentSessionId,
          agentName: opts.agentName,
          description: opts.description,
          parentChain: opts.parentChain,
          systemPrompt: resolveSystemPrompt(opts),
        });
        // 子代理委派不开新会话也不可能命中活跃回合：queued 分支不可达
        if (result.kind === 'queued') {
          return yield* Effect.fail(
            new AgentError(
              'TURN_CONFLICT',
              `concurrent turn on subagent session ${result.sessionId}`
            )
          );
        }
        return {
          stream: result.stream as AsyncGenerator<FrameBody, Result<string, any>, unknown>,
          sessionId: result.sessionId,
        };
      });

    return { runSubagent };
  })
);
