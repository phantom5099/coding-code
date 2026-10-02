import { Layer, Effect } from 'effect';
import { AgentError } from '../core/error.js';
import { HookService } from '../hooks/port.js';
import type { ToolCall, ProfileName } from '../contracts/types.js';
import type { McpToolSpec } from '../contracts/mcp.js';
import type { ToolCatalog, ToolLookup, ToolResult } from '../contracts/tool.js';
import { ToolExecutorService } from './port.js';
import { createToolCatalog } from './catalog.js';

export const ToolExecutorLayer = Layer.effect(ToolExecutorService, Effect.gen(function* () {
    const hooks = yield* HookService;

    function execute(
      name: string,
      args: unknown,
      opts: {
        signal?: AbortSignal;
        sessionId?: string;
        turnId?: number;
        projectPath?: string;
        callId?: string;
        toolLookup?: ToolLookup;
        activeProfile?: ProfileName;
        model: string;
      }
    ): Effect.Effect<{ output: string }, AgentError> {
      return Effect.gen(function* () {
        const tool = opts.toolLookup?.(name);
        if (!tool) return yield* Effect.fail(AgentError.toolNotFound(name));

        const finalArgs = args as Record<string, unknown>;

        const callId = opts.callId;
        yield* hooks.emit('tool.execute.before', {
          toolName: name,
          args: finalArgs,
          sessionId: opts.sessionId,
          turnId: opts.turnId,
          projectPath: opts.projectPath,
          callId,
        });

        const parsedArgs = yield* Effect.sync(() => tool.parse(finalArgs));
        const start = Date.now();

        // Execute tool — now returns Effect directly
        const ctx = {
          signal: opts.signal,
          sessionId: opts.sessionId,
          projectPath: opts.projectPath,
          activeProfile: opts.activeProfile,
          model: opts.model,
        };


        let toolEffect = tool.execute(parsedArgs, ctx);

        if (opts.signal) {
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
          sessionId: opts.sessionId,
          turnId: opts.turnId,
          projectPath: opts.projectPath,
          callId,
        });

        return { output: result };
      }).pipe(
        Effect.tapError((error) =>
          hooks.emit('tool.execute.error', {
            toolName: name,
            args: args as Record<string, unknown>,
            error,
            projectPath: opts.projectPath,
          })
        )
      );
    }

    function execSingle(
      tc: ToolCall,
      sessionId: string | undefined,
      opts: {
        turnId?: number;
        projectPath?: string;
        signal?: AbortSignal;
        toolLookup?: ToolLookup;
        activeProfile?: ProfileName;
        model: string;
      }
    ): Effect.Effect<ToolResult> {
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

    function splitWaves(toolCalls: ToolCall[], toolLookup?: ToolLookup): ToolCall[][] {
      const waves: ToolCall[][] = [];
      let current: ToolCall[] | undefined;
      for (const tc of toolCalls) {
        if (toolLookup?.(tc.name)?.concurrencySafe) {
          if (!current) {
            current = [];
            waves.push(current);
          }
          current.push(tc);
        } else {
          waves.push([tc]);
          current = undefined;
        }
      }
      return waves;
    }

    function executeBatch(
      toolCalls: ToolCall[],
      sessionId: string | undefined,
      opts: {
        turnId?: number;
        projectPath?: string;
        signal?: AbortSignal;
        toolLookup?: ToolLookup;
        activeProfile?: ProfileName;
        model: string;
      }
    ): Effect.Effect<ToolResult[]> {
      return Effect.gen(function* () {

        const runTool = (tc: ToolCall): Effect.Effect<ToolResult> =>
          Effect.suspend(() =>
            opts.signal?.aborted
              ? Effect.succeed({
                  status: 'denied' as const,
                  id: tc.id,
                  name: tc.name,
                  reason: 'aborted',
                })
              : execSingle(tc, sessionId, opts)
          );

        const waveResults = yield* Effect.forEach(
          splitWaves(toolCalls, opts.toolLookup),
          (wave) => Effect.forEach(wave, runTool, { concurrency: 'unbounded' }),
          { concurrency: 1 }
        );

        const byId = new Map<string, ToolResult>();
        for (const wave of waveResults) for (const r of wave) byId.set(r.id, r);
        return toolCalls.map((tc) => byId.get(tc.id)!);
      });
    }

    function prepare(toolNames: readonly string[], mcpTools: McpToolSpec[] = []): Effect.Effect<ToolCatalog> {
      return Effect.sync(() => createToolCatalog(toolNames, mcpTools));
    }

    return { prepare, executeBatch };
}));
