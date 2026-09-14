import { Layer, Effect } from 'effect';
import { AgentError } from '../core/error.js';
import { HookService } from '../hooks/port.js';
import type { ToolCall } from '../contracts/types.js';
import type { ToolLookup, ToolResult } from '../contracts/tool.js';
import { ToolExecutorService } from './port.js';

export const ToolExecutorLayer = Layer.effect(ToolExecutorService, Effect.gen(function* () {
    const hooks = yield* HookService;

    function execute(
      name: string,
      args: unknown,
      opts?: {
        signal?: AbortSignal;
        sessionId?: string;
        turnId?: number;
        projectPath?: string;
        callId?: string;
        toolLookup?: ToolLookup;
      }
    ): any {
      return Effect.gen(function* () {
        const tool = opts?.toolLookup?.(name);
        if (!tool) return yield* Effect.fail(AgentError.toolNotFound(name));

        const finalArgs = args as Record<string, unknown>;

        // Notification hook — use callId for consistent pairing
        const callId = opts?.callId;
        yield* hooks.emit('tool.execute.before', {
          toolName: name,
          args: finalArgs,
          sessionId: opts?.sessionId,
          turnId: opts?.turnId,
          projectPath: opts?.projectPath,
          callId,
        });

        const parsedArgs = yield* Effect.sync(() => tool.parse(finalArgs));
        const start = Date.now();

        // Execute tool — now returns Effect directly
        const ctx = {
          signal: opts?.signal,
          sessionId: opts?.sessionId,
          projectPath: opts?.projectPath,
        };


        let toolEffect = tool.execute(parsedArgs, ctx);

        if (opts?.signal) {
          if (opts.signal.aborted) {
            return yield* Effect.fail(new AgentError('TOOL_NOT_ALLOWED', 'Tool execution aborted'));
          }
          toolEffect = Effect.raceFirst(
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
        toolLookup?: ToolLookup;
      }
    ): Effect.Effect<ToolResult, never, any> {
      return execute(tc.name, tc.arguments ?? {}, { sessionId, callId: tc.id, ...opts }).pipe(
        Effect.matchEffect({
          onSuccess: (result: any): Effect.Effect<ToolResult> =>
            Effect.succeed({
              status: 'ok' as const,
              id: tc.id,
              name: tc.name,
              output: result.output,
            }),
          onFailure: (err): Effect.Effect<ToolResult> => {
            if (err instanceof AgentError && err.code === 'TOOL_NOT_ALLOWED') {
              return Effect.succeed({
                status: 'denied' as const,
                id: tc.id,
                name: tc.name,
                reason: err.message,
              });
            }
            const code = err instanceof AgentError ? err.code : 'TOOL_EXECUTION_FAILED';
            const msg = err instanceof AgentError ? err.message : String(err);
            return Effect.succeed({
              status: 'error' as const,
              id: tc.id,
              name: tc.name,
              output: `[Error: ${code}] ${msg}`,
            });
          },
        }),
        Effect.catchAllDefect((defect) =>
          Effect.succeed({
            status: 'error' as const,
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
        toolLookup?: ToolLookup;
      }
    ): Effect.Effect<ToolResult[], never, any> {
      return Effect.gen(function* () {
        // Separate safe & destructive tools: safe tools run in parallel, Bash runs serially
        const safeTools: ToolCall[] = [];
        const bashTools: ToolCall[] = [];

        for (const tc of toolCalls) {
          if (tc.name === 'execute_command') {
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
                status: 'denied' as const,
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
        const bashResults: ToolResult[] = [];
        for (const tc of bashTools) {
          // Check abort before each tool
          if (opts?.signal?.aborted) {
            bashResults.push({
              status: 'denied' as const,
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

    return { executeBatch };
} as any));
