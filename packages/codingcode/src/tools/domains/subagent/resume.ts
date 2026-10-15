import { z } from 'zod';
import { Effect } from 'effect';
import { AgentError } from '../../../util/error.js';
import { findModel } from '../../../infra/models.js';
import { readSessionMeta } from '../../../session/file-ops.js';
import { transcriptPathOf } from '../../../session/paths.js';
import type { ToolDefinition } from '../../types.js';
import { HookService } from '../../../hooks/port.js';
import { SubagentRunRegistryService } from '../../../subagent/registry.js';

export const resumeAgentTool: ToolDefinition<HookService | SubagentRunRegistryService> = {
  name: 'resume_agent',
  concurrencySafe: true,
  // 续跑的子代理共享工作区并异步写入，父回合须有快照兜底
  mutatesWorkspace: true,
  description:
    'Continue a previously spawned subagent by session id. The subagent keeps its full prior ' +
    'context. Use this after interrupt_agent, or to hand a finished subagent a follow-up task ' +
    'instead of spawning a fresh one.',
  parameters: z.object({
    sessionId: z.string().min(1).describe('session id of the subagent to continue'),
    prompt: z.string().min(1).describe('what to do next in the continued task'),
    model: z
      .string()
      .optional()
      .describe('override model; defaults to the model the subagent was spawned with'),
  }),
  execute: (args, ctx) =>
    Effect.gen(function* () {
      const hooks = yield* HookService;
      const registry = yield* SubagentRunRegistryService;
      const { sessionId, prompt, model } = args as {
        sessionId: string;
        prompt: string;
        model?: string;
      };
      const projectPath = ctx?.projectPath || process.cwd();

      if (!ctx?.activeProfile || !ctx?.sessionId) {
        return yield* Effect.fail(
          new AgentError(
            'CONFIG_MISSING',
            'resume_agent requires the parent session id and profile'
          )
        );
      }

      // 寻址：目标必须是直接子会话 —— 路径由当前会话 id 单跳算出；
      // 根会话 / 兄弟会话的 id 拼出的路径必然不存在，一并按未知拒绝
      const meta = readSessionMeta(transcriptPathOf(projectPath, sessionId, ctx.sessionId));
      if (!meta || meta.parentSessionId !== ctx.sessionId) {
        return yield* Effect.fail(
          new AgentError('INVALID_INPUT', `Unknown subagent: ${sessionId}`)
        );
      }

      const agentName = meta.agentName ?? 'subagent';
      const requestedModel = model?.trim();
      // 默认沿用该子智能体原本生效的模型（会话头落盘值），参数显式传入可覆盖
      const effectiveModel =
        requestedModel && findModel(requestedModel) ? requestedModel : meta.model;

      const decision = yield* hooks.emitDecision('agent.subagent.spawn.before', {
        agentName,
        prompt,
        parentSessionId: ctx.sessionId,
        projectPath,
      });
      if (decision && decision.decision === 'deny') {
        return yield* Effect.fail(
          new AgentError(
            'TOOL_NOT_ALLOWED',
            `Subagent resume denied: ${decision.reason ?? 'no reason'}`
          )
        );
      }

      const handle = yield* registry
        .spawn({
          prompt,
          agentName,
          model: effectiveModel,
          parentSessionId: ctx.sessionId,
          parentCwd: projectPath,
          parentProfile: ctx.activeProfile,
          // 续跑：复用既有子会话与历史上下文；systemPrompt 由 runner 从会话头回读
          resumeSessionId: sessionId,
          parentChain: [ctx.sessionId, ...(ctx.parentChain ?? [])],
        })
        .pipe(
          Effect.mapError((e) =>
            e.code === 'TURN_CONFLICT'
              ? new AgentError(
                  'TURN_CONFLICT',
                  `subagent ${sessionId} is still running; interrupt_agent or wait_agent first`
                )
              : e
          )
        );

      yield* hooks.emit('agent.subagent.spawn.after', {
        childSessionId: handle.sessionId,
        agentName: handle.agentName,
        projectPath,
      });

      return `resumed ${handle.agentName} (${handle.sessionId})`;
    }),
};
