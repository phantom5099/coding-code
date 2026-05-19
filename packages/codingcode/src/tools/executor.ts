import { Effect } from 'effect';
import { AgentError } from '../core/error';
import { ToolService } from './registry';
import { HookService } from '../hooks/registry';
import { ApprovalService } from '../approval/index';
import type { ToolDefinition } from './types';

export class ToolExecutorService extends Effect.Service<ToolExecutorService>()('ToolExecutor', {
  effect: Effect.gen(function* () {
    // Capture dependencies once at construction time
    const registry = yield* ToolService;
    const hooks = yield* HookService;
    const approval = yield* ApprovalService;

    function execute(
      name: string,
      args: unknown,
      opts?: { signal?: AbortSignal },
    ): Effect.Effect<string, AgentError> {
      return Effect.gen(function* () {
        // All services captured from outer closure — no yield* needed for them
        const toolResult = registry.get(name);
        if (!toolResult.ok) return yield* Effect.fail(toolResult.error);
        const tool = toolResult.value as ToolDefinition;

        // 1. Approval pipeline (Layers 1-6)
        const decision = yield* approval.evaluate({
          tool: name,
          input: args as Record<string, unknown>,
        });

        if (decision.type === 'deny') {
          yield* hooks.emit('tool.execute.denied', {
            toolName: name,
            args: args as Record<string, unknown>,
            reason: decision.reason,
            source: decision.source,
          });
          return yield* Effect.fail(
            new AgentError('TOOL_NOT_ALLOWED', decision.reason),
          );
        }

        // Use modified input from pipeline if present
        let finalArgs: Record<string, unknown> =
          decision.type === 'modified'
            ? decision.input
            : (args as Record<string, unknown>);

        // 2. Hook PreToolUse
        const hookDecision = yield* hooks.emitDecision('tool.approval.pre', {
          toolName: name,
          args: finalArgs,
        });

        if (hookDecision?.decision === 'deny') {
          yield* hooks.emit('tool.execute.denied', {
            toolName: name,
            args: finalArgs,
            reason: hookDecision.reason ?? 'denied by hook',
            source: 'hook',
          });
          return yield* Effect.fail(
            new AgentError('TOOL_NOT_ALLOWED', hookDecision.reason ?? 'denied by hook'),
          );
        }

        if (hookDecision?.modifiedInput) {
          finalArgs = hookDecision.modifiedInput;
        }

        // 3. Notification hook (观察型)
        yield* hooks.emit('tool.execute.before', {
          toolName: name,
          args: finalArgs,
        });

        const parsedArgs = yield* Effect.sync(() => tool.parameters.parse(finalArgs));
        const start = Date.now();
        const result = yield* Effect.tryPromise({
          try: () => tool.execute(parsedArgs, opts?.signal),
          catch: (e) =>
            e instanceof AgentError
              ? e
              : AgentError.toolExecutionFailed(name, e),
        });

        yield* hooks.emit('tool.execute.after', {
          toolName: name,
          args: finalArgs,
          result,
          durationMs: Date.now() - start,
        });

        return result;
      }).pipe(
        Effect.tapError((error) =>
          hooks.emit('tool.execute.error', {
            toolName: name,
            args: args as Record<string, unknown>,
            error,
          }),
        ),
      );
    }

    return { execute };
  }),
}) {}
