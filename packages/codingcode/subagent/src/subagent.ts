import { Layer, Effect } from 'effect';
import { SubagentRunnerService, type RunSubagentOptions } from './port.js';
import { AgentService } from '@codingcode/agent';
import { AgentError, BYPASS_PERMISSION_MODE } from '@codingcode/util';
import type { IncomingPart } from '@codingcode/model';
import { readSessionMeta, transcriptPathOf } from '@codingcode/session';

export const SubagentRunnerLayer = Layer.effect(
  SubagentRunnerService,
  Effect.gen(function* () {
    const agent = yield* AgentService;

    /** 续跑：systemPrompt 由会话头承载，从盘上回读，调用方与模型都无需重述 */
    const resolveSystemPrompt = (opts: RunSubagentOptions): string | undefined => {
      if (!opts.sessionId) return opts.subagent?.systemPrompt;
      const meta = readSessionMeta(
        transcriptPathOf({
          ...opts.lineage,
          cwd: opts.cwd,
          sessionId: opts.sessionId,
        })
      );
      return meta?.systemPrompt;
    };

    const runSubagent = (input: readonly IncomingPart[], opts: RunSubagentOptions) =>
      Effect.gen(function* () {
        const systemPrompt = resolveSystemPrompt(opts);
        const result = yield* agent.runTurn(input, {
          ...opts,
          // 子代理不经审批：调用点未给定时固定 bypass，避免继承父会话的审批链路
          permissionMode: opts.permissionMode ?? BYPASS_PERMISSION_MODE,
          subagent: {
            ...opts.subagent,
            ...(systemPrompt !== undefined ? { systemPrompt } : {}),
          },
        });
        if (result.kind === 'queued') {
          return yield* Effect.fail(
            new AgentError(
              'TURN_CONFLICT',
              `concurrent turn on subagent session ${result.sessionId}`
            )
          );
        }
        return {
          stream: result.stream,
          sessionId: result.sessionId,
        };
      });

    return { runSubagent };
  })
);
