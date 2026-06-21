import { Effect } from 'effect';
import { AgentError } from '../core/error.js';
import { HookService } from '../hooks/registry.js';
import { ApprovalService } from '../approval/index.js';
import type { ToolDefinition } from './types.js';
import type { ToolCall } from '../core/types.js';

export type ToolResultUnion =
  | { type: 'ok'; id: string; name: string; output: string }
  | { type: 'denied'; id: string; name: string; reason: string }
  | { type: 'error'; id: string; name: string; output: string };

export type ToolLookup = (name: string) => ToolDefinition | undefined;

export class ToolExecutorService extends Effect.Service<ToolExecutorService>()('ToolExecutor', {
  effect: Effect.gen(function* () {
    const hooks = yield* HookService;
    const approval = yield* ApprovalService;

    function execute(
      name: string,
      args: unknown,
      opts?: {
        signal?: AbortSignal;
        sessionId?: string;
        turnId?: number;
        projectPath?: string;
        approval?: any;
        callId?: string;
        toolLookup?: ToolLookup;
      }
    ): Effect.Effect<
      { output: string; diff?: string; filePath?: string; insertions?: number; deletions?: number },
      AgentError,
      any
    > {
      return Effect.gen(function* () {
        const tool = opts?.toolLookup?.(name);
        if (!tool) return yield* Effect.fail(AgentError.toolNotFound(name));

        // 1. Approval pipeline (Layers 1-6)
        const decisionApproval: typeof approval = opts?.approval ?? approval;
        const decision = yield* decisionApproval.evaluate({
          tool: name,
          input: args as Record<string, unknown>,
          callId: opts?.callId,
          sessionId: opts?.sessionId ?? 'default',
          projectPath: opts?.projectPath,
        });

        if (decision.type === 'deny') {
          yield* hooks.emit('tool.execute.denied', {
            toolName: name,
            args: args as Record<string, unknown>,
            reason: decision.reason,
            source: decision.source,
          });
          return yield* Effect.fail(new AgentError('TOOL_NOT_ALLOWED', decision.reason));
        }

        // Use modified input from pipeline if present
        const finalArgs: Record<string, unknown> =
          decision.type === 'modified' ? decision.input : (args as Record<string, unknown>);

        // 2. Notification hook — use callId for consistent pairing
        const callId = opts?.callId;
        yield* hooks.emit('tool.execute.before', {
          toolName: name,
          args: finalArgs,
          sessionId: opts?.sessionId,
          turnId: opts?.turnId,
          projectPath: opts?.projectPath,
          callId,
        });

        const parsedArgs = yield* Effect.sync(() => tool.parameters.parse(finalArgs));
        const start = Date.now();

        // Execute tool — now returns Effect directly
        const ctx = {
          signal: opts?.signal,
          sessionId: opts?.sessionId,
          turnId: opts?.turnId,
          projectPath: opts?.projectPath,
        };

        // Race tool execution against abort signal for immediate cancellation
        let toolEffect = tool.execute(parsedArgs, ctx);

        if (opts?.signal) {
          if (opts.signal.aborted) {
            return yield* Effect.fail(new AgentError('TOOL_NOT_ALLOWED', 'Tool execution aborted'));
          }
          toolEffect = Effect.race(
            toolEffect,
            Effect.async<string, AgentError>((resume) => {
              const onAbort = () =>
                resume(Effect.fail(new AgentError('TOOL_NOT_ALLOWED', 'Tool execution aborted')));
              opts.signal!.addEventListener('abort', onAbort, { once: true });
              return Effect.sync(() => opts.signal!.removeEventListener('abort', onAbort));
            })
          );
        }

        const result = yield* toolEffect;

        yield* hooks.emit('tool.execute.after', {
          toolName: name,
          args: finalArgs,
          result,
          durationMs: Date.now() - start,
          sessionId: opts?.sessionId,
          turnId: opts?.turnId,
          projectPath: opts?.projectPath,
          callId,
        });

        return { output: result };
      }).pipe(
        Effect.tapError((error) =>
          hooks.emit('tool.execute.error', {
            toolName: name,
            args: args as Record<string, unknown>,
            error,
          })
        )
      );
    }

    function execSingle(
      tc: ToolCall,
      sessionId?: string,
      opts?: {
        turnId?: number;
        projectPath?: string;
        signal?: AbortSignal;
        approval?: any;
        toolLookup?: ToolLookup;
      }
    ): Effect.Effect<ToolResultUnion, never, any> {
      return execute(tc.name, tc.arguments ?? {}, { sessionId, callId: tc.id, ...opts }).pipe(
        Effect.matchEffect({
          onSuccess: (result): Effect.Effect<ToolResultUnion> =>
            Effect.succeed({
              type: 'ok' as const,
              id: tc.id,
              name: tc.name,
              output: result.output,
            }),
          onFailure: (err): Effect.Effect<ToolResultUnion> => {
            if (err instanceof AgentError && err.code === 'TOOL_NOT_ALLOWED') {
              return Effect.succeed({
                type: 'denied' as const,
                id: tc.id,
                name: tc.name,
                reason: err.message,
              });
            }
            const code = err instanceof AgentError ? err.code : 'TOOL_EXECUTION_FAILED';
            const msg = err instanceof AgentError ? err.message : String(err);
            return Effect.succeed({
              type: 'error' as const,
              id: tc.id,
              name: tc.name,
              output: `[Error: ${code}] ${msg}`,
            });
          },
        }),
        Effect.catchAllDefect((defect) =>
          Effect.succeed({
            type: 'error' as const,
            id: tc.id,
            name: tc.name,
            output: `[Unexpected] ${String(defect)}`,
          })
        )
      );
    }

    function executeBatch(
      toolCalls: ToolCall[],
      sessionId?: string,
      opts?: {
        turnId?: number;
        projectPath?: string;
        signal?: AbortSignal;
        approval?: any;
        toolLookup?: ToolLookup;
      }
    ): Effect.Effect<ToolResultUnion[], never, any> {
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
              return Effect.succeed({
                type: 'denied' as const,
                id: tc.id,
                name: tc.name,
                reason: 'aborted',
              });
            }
            return execSingle(tc, sessionId, opts);
          },
          { concurrency: 'unbounded' }
        );

        // Bash tools — serial (avoid race conditions)
        const bashResults: ToolResultUnion[] = [];
        for (const tc of bashTools) {
          // Check abort before each tool
          if (opts?.signal?.aborted) {
            bashResults.push({
              type: 'denied' as const,
              id: tc.id,
              name: tc.name,
              reason: 'aborted',
            });
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
