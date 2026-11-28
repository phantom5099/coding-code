import { z } from 'zod';
import { Effect } from 'effect';
import { AgentError } from '@codingcode/util';
import { findModel } from '@codingcode/model';
import { defineTool } from '@codingcode/tool';
import { HOOK_POINT, HookService } from '@codingcode/hook';
import { SubagentRunRegistryService } from '../registry.js';

const spawnParams = z.object({
  agentName: z
    .string()
    .min(1)
    .describe('short nickname for the subagent; used for identification and display'),
  description: z
    .string()
    .min(1)
    .describe(
      'one-line purpose of the subagent; list_agents shows it so the main agent knows what each subagent does'
    ),
  prompt: z.string().min(1).describe('task description for the subagent'),
  model: z
    .string()
    .optional()
    .describe(
      'set this only when the user asks for a specific model; omit it otherwise and the subagent inherits the parent turn model'
    ),
  systemPrompt: z
    .string()
    .optional()
    .describe(
      'replaces the middle section of the subagent system prompt; the environment block and system notes are kept'
    ),
});

export const spawnAgentTool = defineTool<
  HookService | SubagentRunRegistryService,
  typeof spawnParams
>({
  name: 'spawn_agent',
  concurrencySafe: true,
  approval: { action: 'subagent', requiresConfirmation: true },
  description:
    'Start a subagent and return its session id immediately. The subagent runs in the same working directory ' +
    'and shares your file system: keep the delegated write set disjoint from your own. Its result is appended ' +
    'to this conversation when it finishes.',
  parameters: spawnParams,
  execute: ({ agentName, description, prompt, model, systemPrompt }, ctx) =>
    Effect.gen(function* () {
      const hooks = yield* HookService;
      const subagents = yield* SubagentRunRegistryService;
      const parent = ctx?.session;
      if (!ctx || !parent?.cwd || !ctx.sandboxPolicy) {
        return yield* Effect.fail(
          new AgentError('SANDBOX_POLICY_DENIED', 'spawn_agent requires a sandbox policy')
        );
      }
      if (!parent.sessionId) {
        return yield* Effect.fail(
          new AgentError('CONFIG_MISSING', 'spawn_agent requires the parent session id')
        );
      }

      const requestedModel = model?.trim();
      const effectiveModel =
        requestedModel && findModel(requestedModel) ? requestedModel : ctx.model;

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
            `Subagent spawn denied: ${decision.reason ?? 'no reason'}`
          )
        );
      }

      const handle = yield* subagents.spawn({
        prompt,
        agentName,
        description,
        model: effectiveModel,
        systemPrompt,
        parent,
        parentPermissionMode: ctx.permissionMode ?? 'askBeforeExec',
        parentPolicy: ctx.sandboxPolicy,
      });

      yield* hooks.emit(HOOK_POINT.AGENT_SUBAGENT_SPAWN_AFTER, {
        childSessionId: handle.sessionId,
        agentName: handle.agentName,
        projectPath: parent.cwd,
      });

      return `spawned ${handle.agentName} (${handle.sessionId})`;
    }),
});
