import { randomUUID } from 'crypto';
import { z } from 'zod';
import { Effect } from 'effect';
import type { ToolDefinition } from '../../types.js';
import type { ProjectRuntimeService } from '../../../runtime/project-runtime.js';
import type { SessionService } from '../../../session/store.js';
import type { ApprovalService } from '../../../approval/index.js';
import type { HookService } from '../../../hooks/registry.js';
import type { McpService } from '../../../mcp/index.js';
import { findModel, createClient } from '../../../llm/factory.js';
import { resolveSubagentEnabled, resolveAgentDisabled } from '../../../subagent/registry.js';
import { getAllRules } from '../../../rules/index.js';

interface DispatchAgentDeps {
  session: SessionService;
  approval: ApprovalService;
  hooks: HookService;
  runtime: ProjectRuntimeService;
  mcp: McpService;
}

export function createDispatchAgentTool(deps: DispatchAgentDeps): ToolDefinition {
  return {
    name: 'dispatch_agent',
    description:
      'Spawn an isolated subagent to handle specialized tasks. See "Available Subagents" in the system prompt for available profiles and their capabilities.',
    shortDescription: 'Spawn isolated subagent',
    parameters: z.object({
      agent: z.string().describe('subagent profile name'),
      prompt: z.string().min(1).describe('task description for the subagent'),
    }),
    execute: async (args: any, ctx: any) => {
      const { agent: agentName, prompt } = args;

      const projectPath = ctx?.projectPath || process.cwd();

      // Check global subagent switch
      if (!resolveSubagentEnabled(projectPath)) {
        throw new Error('Subagent dispatch is disabled in global settings');
      }

      // Get profile
      const profile = deps.runtime.resolveSubagentProfile(projectPath, agentName);
      if (!profile) {
        throw new Error(`Unknown subagent: ${agentName}`);
      }

      // Check individual agent disabled state
      if (resolveAgentDisabled(projectPath, agentName)) {
        throw new Error(`Subagent '${agentName}' is disabled`);
      }

      if (!ctx?.agentRunner?.agentService || !ctx?.agentRunner?.llm) {
        throw new Error('dispatch_agent requires agentRunner context');
      }

      const { agentService, llm: parentLlm } = ctx.agentRunner;

      let llm = parentLlm;
      if (profile.model) {
        const entry = findModel(profile.model);
        if (!entry)
          throw new Error(
            `Subagent profile "${agentName}" specifies unknown model: ${profile.model}`
          );
        const clientResult = await createClient(entry);
        if (!clientResult.ok)
          throw new Error(
            `Failed to create client for model "${profile.model}": ${clientResult.error.message}`
          );
        llm = clientResult.value;
      }

      // Emit spawn.before hook (decision hook, can deny)
      const spawnDecision = await Effect.runPromise(
        deps.hooks.emitDecision('agent.subagent.spawn.before', {
          profile: agentName,
          prompt,
          parentSessionId: ctx?.sessionId,
        })
      );
      if (spawnDecision && spawnDecision.decision === 'deny') {
        throw new Error(`Subagent spawn denied: ${spawnDecision.reason ?? 'no reason provided'}`);
      }

      // Create subagent transcript nested under parent session
      const childUuid = randomUUID();

      const createEffect = deps.session.create(projectPath, ctx?.model ?? 'subagent', childUuid, {
        parentSessionId: ctx?.sessionId,
        agentName: agentName,
      });

      const childState = await Effect.runPromise(createEffect);
      deps.session.incrementTurn(childState);
      await Effect.runPromise(deps.session.recordUser(childState, prompt));

      // Approval: bypass for readonly, fork without delegateEmitter for non-readonly
      let childApproval;
      if (profile.readonly) {
        childApproval = undefined;
      } else {
        const forkEffect = deps.approval.fork({ readonly: false });
        childApproval = await Effect.runPromise(forkEffect);
        // Do NOT delegateEmitter — subagent approvals don't pop UI
      }

      // Attach subagent hooks
      if (profile.hooks && profile.hooks.length > 0) {
        await Effect.runPromise(deps.hooks.attachSessionHooks(childUuid, profile.hooks));
      }

      // Connect MCP servers (session lease)
      const mcpServers = profile.mcpServers;
      if (mcpServers?.length) {
        await Effect.runPromise(deps.mcp.connectServers(projectPath, childUuid, mcpServers));
      }

      // Build tool policy from profile
      const childPolicy = deps.runtime.getToolPolicy(profile);

      // Get MCP tools for subagent
      const mcpTools = deps.mcp.listProjectMcpTools(projectPath);

      // Run subagent
      const systemOverride = buildSubagentPrompt(profile, projectPath);
      const stream = agentService.runStream({
        state: childState,
        llm,
        systemOverride,
        toolPolicy: childPolicy,
        mcpTools,
        abortSignal: ctx?.signal,
        parentSessionId: ctx?.sessionId,
        agentName: agentName,
        maxStepsOverride: profile.maxSteps,
        approvalOverride: childApproval,
      });

      // Emit spawn.after hook
      await Effect.runPromise(
        deps.hooks.emit('agent.subagent.spawn.after', {
          childSessionId: childUuid,
          profile: agentName,
        })
      );

      // Collect events and extract result
      let finalContent = '';
      try {
        for await (const event of stream) {
          if (event._tag === 'Done') {
            finalContent = event.content;
          } else if (event._tag === 'Error') {
            await Effect.runPromise(
              deps.hooks.emit('agent.subagent.complete', {
                childSessionId: childUuid,
                profile: agentName,
                status: 'error',
                error: event.error,
              })
            );
            throw new Error(`Subagent failed: ${event.error.message}`);
          }
        }
      } finally {
        // Cleanup
        await Effect.runPromise(deps.mcp.disposeSession(childUuid));
        await Effect.runPromise(deps.hooks.disposeSession(childUuid));
      }

      // Emit completion hook
      await Effect.runPromise(
        deps.hooks.emit('agent.subagent.complete', {
          childSessionId: childUuid,
          profile: agentName,
          status: 'done',
        })
      );

      return finalContent || '(subagent completed without output)';
    },
  };
}

function buildSubagentPrompt(profile: { systemPrompt?: string }, projectPath: string): string {
  const parts: string[] = [];

  if (profile.systemPrompt) {
    parts.push(profile.systemPrompt);
  }

  parts.push(`## Environment
- Working directory: ${projectPath}
- Operating system: ${process.platform}
- Shell: ${process.env.SHELL || process.env.ComSpec || 'bash'}`);

  const rules = getAllRules(projectPath);
  if (rules) {
    parts.push(`## User-defined Rules\n\nThe following rules MUST be followed at all times. They override any conflicting instructions above.\n\n${rules}`);
  }

  return parts.filter(Boolean).join('\n\n');
}
