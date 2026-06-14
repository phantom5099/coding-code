import { randomUUID } from 'crypto';
import { z } from 'zod';
import { Effect } from 'effect';
import { AgentError } from '../../../core/error.js';
import type { ToolDefinition, ToolExecCtx } from '../../types.js';
import { SessionService } from '../../../session/store.js';
import { ApprovalService } from '../../../approval/index.js';
import { HookService } from '../../../hooks/registry.js';
import { McpService } from '../../../mcp/index.js';
import { LLMFactoryService } from '../../../llm/factory.js';
import { resolveSubagentEnabled, resolveAgentDisabled } from '../../../subagent/registry.js';
import { RulesService } from '../../../rules/index.js';
import { ProjectRuntimeService } from '../../../runtime/project-runtime.js';
import { SubagentRunnerService } from '../../../subagent/runner-service.js';

export function createDispatchAgentTool(): Effect.Effect<
  ToolDefinition,
  never,
  | SessionService
  | ApprovalService
  | HookService
  | McpService
  | ProjectRuntimeService
  | LLMFactoryService
  | RulesService
  | SubagentRunnerService
> {
  return Effect.gen(function* () {
    const session = yield* SessionService;
    const approval = yield* ApprovalService;
    const hooks = yield* HookService;
    const mcp = yield* McpService;
    const runtime = yield* ProjectRuntimeService;
    const factory = yield* LLMFactoryService;
    const rulesService = yield* RulesService;
    const runner = yield* SubagentRunnerService;

    return {
      name: 'dispatch_agent',
      description:
        'Spawn an isolated subagent to handle specialized tasks. See "Available Subagents" in the system prompt for available profiles and their capabilities.',
      shortDescription: 'Spawn isolated subagent',
      parameters: z.object({
        agent: z.string().describe('subagent profile name'),
        prompt: z.string().min(1).describe('task description for the subagent'),
      }),
      execute: (args: unknown, ctx?: ToolExecCtx): Effect.Effect<string, AgentError> =>
        Effect.gen(function* () {
          const { agent: agentName, prompt } = args as { agent: string; prompt: string };

          const projectPath = ctx?.projectPath || process.cwd();

          // Check global subagent switch
          if (!resolveSubagentEnabled(projectPath)) {
            return yield* Effect.fail(
              new AgentError(
                'TOOL_EXECUTION_FAILED',
                'Subagent dispatch is disabled in global settings'
              )
            );
          }

          // Get profile
          const profile = runtime.resolveSubagentProfile(projectPath, agentName);
          if (!profile) {
            return yield* Effect.fail(
              new AgentError('TOOL_EXECUTION_FAILED', `Unknown subagent: ${agentName}`)
            );
          }

          // Check individual agent disabled state
          if (resolveAgentDisabled(projectPath, agentName)) {
            return yield* Effect.fail(
              new AgentError('TOOL_EXECUTION_FAILED', `Subagent '${agentName}' is disabled`)
            );
          }

          let llm = yield* factory.getLLMClient();
          if (profile.model) {
            const entry = yield* factory.findModel(profile.model);
            if (!entry) {
              return yield* Effect.fail(
                new AgentError(
                  'TOOL_EXECUTION_FAILED',
                  `Subagent profile "${agentName}" specifies unknown model: ${profile.model}`
                )
              );
            }
            llm = yield* factory.createClient(entry);
          }

          // Emit spawn.before hook (decision hook, can deny)
          const spawnDecision = yield* hooks.emitDecision('agent.subagent.spawn.before', {
            profile: agentName,
            prompt,
            parentSessionId: ctx?.sessionId,
          });
          if (spawnDecision && spawnDecision.decision === 'deny') {
            return yield* Effect.fail(
              new AgentError(
                'TOOL_NOT_ALLOWED',
                `Subagent spawn denied: ${spawnDecision.reason ?? 'no reason provided'}`
              )
            );
          }

          // Create subagent transcript nested under parent session
          const childUuid = randomUUID();

          const childState = yield* session.create(
            projectPath,
            (ctx as any)?.model ?? 'subagent',
            childUuid,
            {
              parentSessionId: ctx?.sessionId,
              agentName: agentName,
            }
          );
          session.incrementTurn(childState);
          yield* session.recordUser(childState, prompt);

          // Approval: bypass for readonly, fork without delegateEmitter for non-readonly
          let childApproval;
          if (!profile.readonly) {
            childApproval = yield* approval.fork({ readonly: false });
          }

          // Attach subagent hooks
          if (profile.hooks && profile.hooks.length > 0) {
            yield* hooks.attachSessionHooks(childUuid, profile.hooks);
          }

          // Connect MCP servers (session lease)
          const mcpServers = profile.mcpServers;
          if (mcpServers?.length) {
            yield* mcp.connectServers(projectPath, childUuid, mcpServers);
          }

          // Build tool policy from profile
          const childPolicy = runtime.getToolPolicy(profile);

          // Get MCP tools for subagent
          const mcpTools = mcp.listProjectMcpTools(projectPath);

          // Run subagent
          const rulesText = rulesService.getAllRules(projectPath);
          const systemOverride = buildSubagentPrompt(profile, projectPath, rulesText);
          const stream = runner.runStream({
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
          yield* hooks.emit('agent.subagent.spawn.after', {
            childSessionId: childUuid,
            profile: agentName,
          });

          // Collect events and extract result — wrap AsyncGenerator in Effect
          const finalContent = yield* Effect.async<string, AgentError>((resume) => {
            let content = '';
            (async () => {
              try {
                for await (const event of stream) {
                  if (event._tag === 'Done') {
                    content = event.content;
                  } else if (event._tag === 'Error') {
                    resume(
                      Effect.fail(
                        new AgentError(
                          'TOOL_EXECUTION_FAILED',
                          `Subagent failed: ${event.error.message}`
                        )
                      )
                    );
                    return;
                  }
                }

                // Cleanup
                await Effect.runPromise(mcp.disposeSession(childUuid));
                await Effect.runPromise(hooks.disposeSession(childUuid));

                // Emit completion hook
                await Effect.runPromise(
                  hooks.emit('agent.subagent.complete', {
                    childSessionId: childUuid,
                    profile: agentName,
                    status: 'done',
                  })
                );

                resume(Effect.succeed(content || '(subagent completed without output)'));
              } catch (e) {
                // Cleanup on unexpected error
                try {
                  await Effect.runPromise(mcp.disposeSession(childUuid));
                  await Effect.runPromise(hooks.disposeSession(childUuid));
                } catch {
                  /* ignore cleanup errors */
                }
                const msg = e instanceof Error ? e.message : String(e);
                resume(Effect.fail(new AgentError('TOOL_EXECUTION_FAILED', msg)));
              }
            })();
          });

          return finalContent;
        }) as Effect.Effect<string, AgentError>,
    };
  });
}

function buildSubagentPrompt(
  profile: { systemPrompt?: string },
  projectPath: string,
  rules?: string
): string {
  const parts: string[] = [];

  if (profile.systemPrompt) {
    parts.push(profile.systemPrompt);
  }

  parts.push(`## Environment
- Working directory: ${projectPath}
- Operating system: ${process.platform}
- Shell: ${process.env.SHELL || process.env.ComSpec || 'bash'}`);

  if (rules) {
    parts.push(
      `## User-defined Rules\n\nThe following rules MUST be followed at all times. They override any conflicting instructions above.\n\n${rules}`
    );
  }

  return parts.filter(Boolean).join('\n\n');
}
