import { z } from 'zod';
import { Effect } from 'effect';
import { AgentError } from '../../../core/error.js';
import type { ToolDefinition } from '../../types.js';
import { HookService } from '../../../hooks/port.js';
import { McpService } from '../../../mcp/port.js';
import { SubagentRunnerService } from '../../../subagent/port.js';
import { resolveSubagentProfile } from '../../../agent/profile.js';

export const dispatchAgentTool: ToolDefinition<
  HookService | McpService | SubagentRunnerService
> = {
  name: 'dispatch_agent',
  description:
    'Spawn an isolated subagent to handle specialized tasks. See "Available Subagents" in the system prompt for available profiles and their capabilities.',
  parameters: z.object({
    agent: z.string().describe('subagent profile name'),
    prompt: z.string().min(1).describe('task description for the subagent'),
  }),
  execute: (args, ctx) =>
    Effect.gen(function* () {
      const hooks = yield* HookService;
      const mcp = yield* McpService;
      const runner = yield* SubagentRunnerService;

      const { agent: agentName, prompt } = args as { agent: string; prompt: string };
      const projectPath = ctx?.projectPath || process.cwd();

      const profile = resolveSubagentProfile(agentName);
      if (!profile) {
        return yield* Effect.fail(
          new AgentError('TOOL_EXECUTION_FAILED', `Unknown subagent: ${agentName}`)
        );
      }

      const parentSessionId = ctx?.sessionId;
      const spawnDecision = yield* hooks.emitDecision('agent.subagent.spawn.before', {
        profile: agentName, prompt, parentSessionId,
      });
      if (spawnDecision && spawnDecision.decision === 'deny') {
        return yield* Effect.fail(
          new AgentError('TOOL_NOT_ALLOWED', `Subagent spawn denied: ${spawnDecision.reason ?? 'no reason'}`)
        );
      }

      const { stream, sessionId: childUuid } = yield* runner.runSubagent(prompt, {
        cwd: projectPath,
        signal: ctx?.signal,
        activeProfile: profile.name as any,
        parentSessionId: ctx?.sessionId,
        agentName,
      });

      yield* hooks.emit('agent.subagent.spawn.after', { childSessionId: childUuid, profile: agentName });

      let didComplete = false;
      const finalContent = yield* Effect.async<string, AgentError>((resume) => {
        let content = '';
        (async () => {
          try {
            for await (const body of stream) {
              if (body.family === 'event') {
                if (body.event.type === 'text_delta') content += body.event.text;
                continue;
              }
              if (
                body.family === 'transition' &&
                body.transition.to === 'end' &&
                body.transition.reason === 'error'
              ) {
                resume(Effect.fail(new AgentError('TOOL_EXECUTION_FAILED', `Subagent failed: ${body.transition.error.message}`)));
                return;
              }
            }
            await Effect.runPromise(mcp.disposeSession(childUuid));
            await Effect.runPromise(hooks.disposeSession(childUuid));
            didComplete = true;
            resume(Effect.succeed(content || '(subagent completed without output)'));
          } catch (e) {
            try {
              await Effect.runPromise(mcp.disposeSession(childUuid));
              await Effect.runPromise(hooks.disposeSession(childUuid));
            } catch { /* ignore */ }
            const msg = e instanceof Error ? e.message : String(e);
            resume(Effect.fail(new AgentError('TOOL_EXECUTION_FAILED', msg)));
          }
        })();
      });

      if (didComplete) {
        yield* hooks.emit('agent.subagent.complete', { childSessionId: childUuid, profile: agentName, status: 'done' }).pipe(Effect.ignore);
      }

      return finalContent;
    }),
};
