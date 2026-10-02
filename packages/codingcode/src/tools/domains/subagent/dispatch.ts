import { z } from 'zod';
import { Effect } from 'effect';
import { AgentError } from '../../../core/error.js';
import { findModel } from '../../../infra/models.js';
import type { ToolDefinition } from '../../types.js';
import { HookService } from '../../../hooks/port.js';
import { SubagentRunnerService } from '../../../subagent/port.js';

export const dispatchAgentTool: ToolDefinition<HookService | SubagentRunnerService> = {
  name: 'dispatch_agent',
  concurrencySafe: false,
  description:
    'Delegate a task to a subagent. The subagent runs in the same working directory as you and returns its final output. '
    + 'Keep the delegated write set disjoint from the files you edit yourself.',
  parameters: z.object({
    agentName: z.string().min(1).describe('short nickname for the subagent; used for identification and display'),
    prompt: z.string().min(1).describe('task description for the subagent'),
    model: z.string().optional().describe('model id for the subagent; must exist in models.json, otherwise the model of the current turn is used'),
    systemPrompt: z.string().optional().describe('replaces the middle section of the subagent system prompt; the environment block and system notes are kept'),
  }),
  execute: (args, ctx) =>
    Effect.gen(function* () {
      const hooks = yield* HookService;
      const runner = yield* SubagentRunnerService;

      const { agentName, prompt, model, systemPrompt } = args as {
        agentName: string; prompt: string; model?: string; systemPrompt?: string;
      };
      const projectPath = ctx?.projectPath || process.cwd();

      if (!ctx?.activeProfile) {
        return yield* Effect.fail(
          new AgentError('CONFIG_MISSING', 'dispatch_agent requires the parent session activeProfile')
        );
      }

      const parentSessionId = ctx?.sessionId;
      // 子代理只跑在模型清单内的模型上，参数空或不在清单里都继承父回合的模型
      const requestedModel = model?.trim();
      const effectiveModel = requestedModel && findModel(requestedModel) ? requestedModel : ctx.model;
      const spawnDecision = yield* hooks.emitDecision('agent.subagent.spawn.before', {
        agentName, prompt, parentSessionId, projectPath,
      });
      if (spawnDecision && spawnDecision.decision === 'deny') {
        return yield* Effect.fail(
          new AgentError('TOOL_NOT_ALLOWED', `Subagent spawn denied: ${spawnDecision.reason ?? 'no reason'}`)
        );
      }

      const { stream, sessionId: childUuid } = yield* runner.runSubagent(prompt, {
        cwd: projectPath,
        signal: ctx?.signal,
        activeProfile: ctx.activeProfile,
        permissionMode: 'bypass',
        parentSessionId,
        agentName,
        model: effectiveModel,
        systemPrompt,
      });

      yield* hooks.emit('agent.subagent.spawn.after', {
        childSessionId: childUuid, agentName, projectPath,
      });

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
            didComplete = true;
            resume(Effect.succeed(content || '(subagent completed without output)'));
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            resume(Effect.fail(new AgentError('TOOL_EXECUTION_FAILED', msg)));
          }
        })();
      });

      if (didComplete) {
        yield* hooks.emit('agent.subagent.complete', {
          childSessionId: childUuid, agentName, status: 'done', projectPath,
        }).pipe(Effect.ignore);
      }

      return finalContent;
    }),
};
