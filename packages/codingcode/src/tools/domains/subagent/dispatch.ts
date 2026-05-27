import { randomUUID } from 'crypto';
import { z } from 'zod';
import { Effect } from 'effect';
import type { ToolDefinition } from '../../types.js';
import type { SubagentRegistry } from '../../../subagent/registry.js';
import type { SessionService } from '../../../session/store.js';
import type { ApprovalService } from '../../../approval/index.js';
import type { HookService } from '../../../hooks/registry.js';
import type { McpService } from '../../../mcp/index.js';
import { findModel, createClient } from '../../../llm/factory.js';
import { delegateEmitter, unregisterEmitter } from '../../../approval/async-confirm.js';

interface DispatchAgentDeps {
  session: SessionService;
  approval: ApprovalService;
  hooks: HookService;
  registry: SubagentRegistry;
  mcp: McpService;
}

export function createDispatchAgentTool(deps: DispatchAgentDeps): ToolDefinition {
  return {
    name: 'dispatch_agent',
    description: 'Spawn an isolated subagent with its own context. Available profiles: ' +
      deps.registry.list().map(p => `"${p.name}" (${p.description})`).join(', '),
    shortDescription: 'Spawn isolated subagent',
    parameters: z.object({
      agent: z.string().describe('subagent profile name'),
      prompt: z.string().min(1).describe('task description for the subagent'),
    }),
    execute: async (args: any, ctx: any) => {
      const { agent: agentName, prompt } = args;

      // Get profile
      const profile = deps.registry.get(agentName);
      if (!profile) {
        throw new Error(`Unknown subagent: ${agentName}`);
      }

      if (!deps.registry.isEnabled()) {
        throw new Error('Subagent is disabled');
      }

      if (deps.registry.isAgentDisabled(agentName)) {
        throw new Error(`Subagent '${agentName}' is disabled`);
      }

      if (!ctx?.agentRunner?.agentService || !ctx?.agentRunner?.llm) {
        throw new Error('dispatch_agent requires agentRunner context');
      }

      const { agentService, llm: parentLlm } = ctx.agentRunner;

      let llm = parentLlm;
      if (profile.model) {
        const entry = findModel(profile.model);
        if (!entry) throw new Error(`Subagent profile "${agentName}" specifies unknown model: ${profile.model}`);
        const clientResult = await createClient(entry);
        if (!clientResult.ok) throw new Error(`Failed to create client for model "${profile.model}": ${clientResult.error.message}`);
        llm = clientResult.value;
      }

      // Emit spawn.before hook
      const spawnDecision: any = await Effect.runPromise(
        (deps.hooks as any).emitDecision('agent.subagent.spawn.before', {
          profile: agentName,
          prompt,
          parentSessionId: ctx?.sessionId,
        }),
      );

      if (spawnDecision && spawnDecision.decision === 'deny') {
        throw new Error(`Subagent spawn denied: ${spawnDecision.reason ?? 'no reason provided'}`);
      }

      // Create subagent transcript nested under parent session
      const childUuid = randomUUID();

      const createEffect = (deps.session as any).create(
        ctx?.projectPath ?? process.cwd(),
        ctx?.model ?? 'subagent',
        '0.1.0',
        childUuid,
        {
          parentSessionId: ctx?.sessionId,
          agentName: agentName,
        },
      );

      const childState = await Effect.runPromise(createEffect);
      (deps.session as any).incrementTurn(childState);
      await Effect.runPromise((deps.session as any).recordUser(childState, prompt));

      // Fork approval service with readonly if needed
      const forkEffect = (deps.approval as any).fork({ readonly: profile.readonly });
      const childApproval = await Effect.runPromise(forkEffect);

      // Delegate parent's emitter to child so subagent approval requests reach the desktop UI
      const parentSessionId = ctx?.sessionId;
      if (parentSessionId) {
        delegateEmitter(childUuid, parentSessionId);
      }

      // Connect MCP servers for this profile (refCount++)
      const mcpServers = profile.mcpServers;
      if (mcpServers?.length) {
        const projectRoot = ctx?.projectPath ?? process.cwd();
        await Effect.runPromise(deps.mcp.connectServers(mcpServers, projectRoot));
      }

      // Build coreAllowlist: profile tools + MCP server tools
      let coreAllowlist: Set<string> | undefined = profile.tools
        ? new Set(profile.tools.filter((t: string) => t !== 'dispatch_agent'))
        : undefined;

      if (mcpServers?.length) {
        if (!coreAllowlist) coreAllowlist = new Set();
        for (const serverName of mcpServers) {
          for (const toolName of deps.mcp.getServerToolNames(serverName)) {
            coreAllowlist.add(toolName);
          }
        }
      }

      // Run subagent in isolated context
      const stream = agentService.runStream({
        state: childState,
        llm,
        systemOverride: profile.systemPrompt,
        coreAllowlist,
        abortSignal: ctx?.signal,
        parentSessionId: ctx?.sessionId,
        agentName: agentName,
        maxStepsOverride: profile.maxSteps,
        approvalOverride: childApproval,
      });

      // Collect events and extract final result
      let finalContent = '';
      try {
        for await (const event of stream) {
          if (event._tag === 'Done') {
            finalContent = event.content;
          } else if (event._tag === 'Error') {
            await Effect.runPromise(
              (deps.hooks as any).emit('agent.subagent.complete', {
                childSessionId: childUuid,
                profile: agentName,
                status: 'error',
                error: event.error,
              }),
            );
            throw new Error(`Subagent failed: ${event.error.message}`);
          }
        }
      } finally {
        unregisterEmitter(childUuid);
        // Disconnect MCP servers (refCount--)
        if (mcpServers?.length) {
          await Effect.runPromise(deps.mcp.disconnectServers(mcpServers));
        }
      }

      // Emit completion hook
      await Effect.runPromise(
        (deps.hooks as any).emit('agent.subagent.complete', {
          childSessionId: childUuid,
          profile: agentName,
          status: 'done',
        }),
      );

      return finalContent || '(subagent completed without output)';
    },
  };
}
