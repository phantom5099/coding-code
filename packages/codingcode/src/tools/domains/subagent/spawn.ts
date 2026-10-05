import { z } from 'zod';
import { Effect } from 'effect';
import { AgentError } from '../../../core/error.js';
import { findModel } from '../../../infra/models.js';
import type { ToolDefinition } from '../../types.js';
import { HookService } from '../../../hooks/port.js';
import { SubagentRunRegistryService } from '../../../subagent/registry.js';

export const spawnAgentTool: ToolDefinition<HookService | SubagentRunRegistryService> = {
  name: 'spawn_agent',
  concurrencySafe: true,
  description:
    'Start a subagent and return its session id immediately. The subagent runs in the same working directory '
    + 'and shares your file system: keep the delegated write set disjoint from your own. Its result is appended '
    + 'to this conversation when it finishes.',
  parameters: z.object({
    agentName: z.string().min(1).describe('short nickname for the subagent; used for identification and display'),
    prompt: z.string().min(1).describe('task description for the subagent'),
    model: z.string().optional().describe('set this only when the user asks for a specific model; omit it otherwise and the subagent inherits the parent turn model'),
    systemPrompt: z.string().optional().describe('replaces the middle section of the subagent system prompt; the environment block and system notes are kept'),
  }),
  execute: (args, ctx) =>
    Effect.gen(function* () {
      const hooks = yield* HookService;
      const registry = yield* SubagentRunRegistryService;
      const { agentName, prompt, model, systemPrompt } = args as {
        agentName: string; prompt: string; model?: string; systemPrompt?: string;
      };
      const projectPath = ctx?.projectPath || process.cwd();

      if (!ctx?.activeProfile || !ctx?.sessionId) {
        return yield* Effect.fail(
          new AgentError('CONFIG_MISSING', 'spawn_agent requires the parent session id and profile')
        );
      }

      const requestedModel = model?.trim();
      const effectiveModel = requestedModel && findModel(requestedModel) ? requestedModel : ctx.model;

      const decision = yield* hooks.emitDecision('agent.subagent.spawn.before', {
        agentName, prompt, parentSessionId: ctx.sessionId, projectPath,
      });
      if (decision && decision.decision === 'deny') {
        return yield* Effect.fail(
          new AgentError('TOOL_NOT_ALLOWED', `Subagent spawn denied: ${decision.reason ?? 'no reason'}`)
        );
      }

      const handle = yield* registry.spawn({
        prompt, agentName, model: effectiveModel, systemPrompt,
        parentSessionId: ctx.sessionId,
        parentCwd: projectPath,
        parentProfile: ctx.activeProfile,
      });

      yield* hooks.emit('agent.subagent.spawn.after', {
        childSessionId: handle.sessionId, agentName: handle.agentName, projectPath,
      });

      return `spawned ${handle.agentName} (${handle.sessionId})`;
    }),
};
