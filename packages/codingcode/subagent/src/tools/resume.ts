import { z } from 'zod';
import { Effect } from 'effect';
import { AgentError } from '@codingcode/util';
import { findModel } from '@codingcode/model';
import { deriveChildLocator, readSessionMeta, transcriptPathOf } from '@codingcode/session';
import { defineTool } from '@codingcode/tool';
import { HOOK_POINT, HookService } from '@codingcode/hook';
import { SubagentRunRegistryService } from '../registry.js';

const resumeParams = z.object({
  sessionId: z.string().min(1).describe('session id of the subagent to continue'),
  prompt: z.string().min(1).describe('what to do next in the continued task'),
  model: z
    .string()
    .optional()
    .describe('override model; defaults to the model the subagent was spawned with'),
});

export const resumeAgentTool = defineTool<
  HookService | SubagentRunRegistryService,
  typeof resumeParams
>({
  name: 'resume_agent',
  concurrencySafe: true,
  approval: { action: 'subagent', requiresConfirmation: true },
  description:
    'Continue a previously spawned subagent by session id. The subagent keeps its full prior ' +
    'context. Use this after interrupt_agent, or to hand a finished subagent a follow-up task ' +
    'instead of spawning a fresh one.',
  parameters: resumeParams,
  execute: ({ sessionId, prompt, model }, ctx) =>
    Effect.gen(function* () {
      const hooks = yield* HookService;
      const subagents = yield* SubagentRunRegistryService;
      const parent = ctx?.session;
      if (!ctx || !parent?.cwd || !ctx.sandboxPolicy) {
        return yield* Effect.fail(
          new AgentError('SANDBOX_POLICY_DENIED', 'resume_agent requires a sandbox policy')
        );
      }
      if (!parent.sessionId) {
        return yield* Effect.fail(
          new AgentError('CONFIG_MISSING', 'resume_agent requires the parent session id')
        );
      }

      const meta = readSessionMeta(transcriptPathOf(deriveChildLocator(parent, sessionId)));
      if (!meta || meta.parentSessionId !== parent.sessionId) {
        return yield* Effect.fail(
          new AgentError('INVALID_INPUT', `Unknown subagent: ${sessionId}`)
        );
      }

      const agentName = meta.agentName ?? 'subagent';
      const requestedModel = model?.trim();
      const effectiveModel =
        requestedModel && findModel(requestedModel) ? requestedModel : meta.model;

      const decision = yield* hooks.emitDecision(HOOK_POINT.AGENT_SUBAGENT_SPAWN_BEFORE, {
        agentName,
        prompt,
        parentSessionId: parent.sessionId,
        projectPath: parent.cwd,
      });
      if (decision && decision.decision === 'deny') {
        return yield* Effect.fail(
          new AgentError(
            'TOOL_NOT_ALLOWED',
            `Subagent resume denied: ${decision.reason ?? 'no reason'}`
          )
        );
      }

      const handle = yield* subagents
        .spawn({
          prompt,
          agentName,
          model: effectiveModel,
          parent,
          parentPermissionMode: ctx.permissionMode ?? 'askBeforeExec',
          parentPolicy: ctx.sandboxPolicy,
          resumeSessionId: sessionId,
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

      yield* hooks.emit(HOOK_POINT.AGENT_SUBAGENT_SPAWN_AFTER, {
        childSessionId: handle.sessionId,
        agentName: handle.agentName,
        projectPath: parent.cwd,
      });

      return `resumed ${handle.agentName} (${handle.sessionId})`;
    }),
});
