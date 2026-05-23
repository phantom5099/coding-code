import { Effect } from 'effect';
import { AgentError } from '../core/error';
import { ToolService } from './registry';
import { HookService } from '../hooks/registry';
import { ApprovalService } from '../approval/index';
import type { ToolDefinition } from './types';
import type { ToolCall } from '../core/types';

export type ToolResultUnion =
  | { type: 'ok'; id: string; name: string; output: string }
  | { type: 'denied'; id: string; name: string; reason: string }
  | { type: 'error'; id: string; name: string; output: string };

export class ToolExecutorService extends Effect.Service<ToolExecutorService>()('ToolExecutor', {
  effect: Effect.gen(function* () {
    // Capture dependencies once at construction time
    const registry = yield* ToolService;
    const hooks = yield* HookService;
    const approval = yield* ApprovalService;

    function execute(
      name: string,
      args: unknown,
      opts?: { signal?: AbortSignal; sessionId?: string; turnId?: number; projectPath?: string; agentId?: string; approval?: any; agentRunner?: any },
    ): Effect.Effect<string, AgentError> {
      return Effect.gen(function* () {
        // All services captured from outer closure — no yield* needed for them
        const toolResult = registry.get(name);
        if (!toolResult.ok) return yield* Effect.fail(toolResult.error);
        const tool = toolResult.value as ToolDefinition;

        // 1. Approval pipeline (Layers 1-6)
        const decisionApproval: typeof approval = opts?.approval ?? approval;
        const decision = yield* decisionApproval.evaluate({
          tool: name,
          input: args as Record<string, unknown>,
          sessionId: opts?.sessionId ?? 'default',
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
          sessionId: opts?.sessionId,
          turnId: opts?.turnId,
          projectPath: opts?.projectPath,
        });

        const parsedArgs = yield* Effect.sync(() => tool.parameters.parse(finalArgs));
        const start = Date.now();
        const result = yield* Effect.tryPromise({
          try: () => tool.execute(parsedArgs, {
            signal: opts?.signal,
            agentId: opts?.agentId,
            sessionId: opts?.sessionId,
            turnId: opts?.turnId,
            projectPath: opts?.projectPath,
            agentRunner: opts?.agentRunner,
          }),
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
          sessionId: opts?.sessionId,
          turnId: opts?.turnId,
          projectPath: opts?.projectPath,
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

    function execSingle(tc: ToolCall, sessionId?: string, opts?: { turnId?: number; projectPath?: string; agentId?: string; signal?: AbortSignal; approval?: any; agentRunner?: any }): Effect.Effect<ToolResultUnion> {
      return execute(tc.name, tc.arguments ?? {}, { sessionId, ...opts }).pipe(
        Effect.matchEffect({
          onSuccess: (output): Effect.Effect<ToolResultUnion> =>
            Effect.succeed({ type: 'ok' as const, id: tc.id, name: tc.name, output }),
          onFailure: (err): Effect.Effect<ToolResultUnion> => {
            if (err instanceof AgentError && err.code === 'TOOL_NOT_ALLOWED') {
              return Effect.succeed({ type: 'denied' as const, id: tc.id, name: tc.name, reason: err.message });
            }
            const code = err instanceof AgentError ? err.code : 'TOOL_EXECUTION_FAILED';
            const msg = err instanceof AgentError ? err.message : String(err);
            return Effect.succeed({ type: 'error' as const, id: tc.id, name: tc.name, output: `[Error: ${code}] ${msg}` });
          },
        }),
        Effect.catchAllDefect((defect) =>
          Effect.succeed({ type: 'error' as const, id: tc.id, name: tc.name, output: `[Unexpected] ${String(defect)}` }),
        ),
      );
    }

    function executeBatch(toolCalls: ToolCall[], sessionId?: string, opts?: { turnId?: number; projectPath?: string; agentId?: string; signal?: AbortSignal; approval?: any; agentRunner?: any }): Effect.Effect<ToolResultUnion[]> {
      return Effect.gen(function* () {
        // Separate safe & destructive tools: safe tools run in parallel, Bash runs serially
        const safeTools: ToolCall[] = [];
        const bashTools: ToolCall[] = [];

        for (const tc of toolCalls) {
          if (tc.name === 'execute_command' || tc.name === 'Bash') {
            bashTools.push(tc);
          } else {
            safeTools.push(tc);
          }
        }

        // Safe tools — parallel
        const safeResults = yield* Effect.forEach(
          safeTools,
          (tc) => {
            // Check abort before each tool
            if (opts?.signal?.aborted) {
              return Effect.succeed({ type: 'denied' as const, id: tc.id, name: tc.name, reason: 'aborted' });
            }
            return execSingle(tc, sessionId, opts);
          },
          { concurrency: 'unbounded' },
        );

        // Bash tools — serial (avoid race conditions)
        const bashResults: ToolResultUnion[] = [];
        for (const tc of bashTools) {
          // Check abort before each tool
          if (opts?.signal?.aborted) {
            bashResults.push({ type: 'denied' as const, id: tc.id, name: tc.name, reason: 'aborted' });
            continue;
          }
          const r = yield* execSingle(tc, sessionId, opts);
          bashResults.push(r);
        }

        return [...safeResults, ...bashResults];
      });
    }

    return { execute, executeBatch };
  }),
}) {}
