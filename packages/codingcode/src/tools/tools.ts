import { Layer, Effect } from 'effect';
import { createHash } from 'node:crypto';
import { AgentError } from '../util/error.js';
import { HookService } from '../hooks/port.js';
import type { ToolCall } from '../llm/types.js';
import type { McpToolSpec } from '../mcp/types.js';
import type {
  ParsedToolCall,
  PreparedToolBatch,
  PreparedToolCall,
  ToolCatalog,
  ToolExecCall,
  ToolExecCtx,
  ToolExecOpts,
  ToolLookup,
  ToolResult,
} from './types.js';
import { resolveSandboxPolicy } from '../sandbox/policy.js';
import type { SandboxPolicy } from '../sandbox/types.js';
import { ToolExecutorService } from './port.js';
import { createToolCatalog } from './catalog.js';

function toToolCtx(opts: ToolExecCall): ToolExecCtx {
  const { turnId: _turnId, ...ctx } = opts;
  return ctx;
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key])}`
    )
    .join(',')}}`;
}

function argsHash(value: unknown): string {
  return createHash('sha256').update(stableSerialize(value)).digest('hex');
}

function compatibilityPolicy(projectPath: string | undefined, sessionId: string | undefined): SandboxPolicy {
  if (!projectPath) throw new AgentError('SANDBOX_PATH_DENIED', 'projectPath is required for tool execution');
  return {
    mode: 'unrestricted',
    workspaceRoot: projectPath,
    additionalWritableRoots: [],
    network: { mode: 'unrestricted', hosts: [], ports: [] },
    sessionId: sessionId ?? 'compatibility',
    enforcement: 'disabled',
    fingerprint: 'compatibility',
  };
}

export const ToolExecutorLayer = Layer.effect(
  ToolExecutorService,
  Effect.gen(function* () {
    const hooks = yield* HookService;

    function parseCall(
      toolCall: ToolCall,
      toolLookup: ToolLookup
    ): Effect.Effect<ParsedToolCall, AgentError> {
      return Effect.gen(function* () {
        const runner = toolLookup(toolCall.name);
        if (!runner) return yield* Effect.fail(AgentError.toolNotFound(toolCall.name));
        const parsedArgs = yield* Effect.try({
          try: () => runner.parse(toolCall.arguments ?? {}),
          catch: (error) => AgentError.toolExecutionFailed(toolCall.name, error),
        });
        return {
          call: toolCall,
          runner,
          parsedArgs,
          argsHash: argsHash(parsedArgs),
          operation: runner.describeOperation(parsedArgs),
        };
      });
    }

    function prepareBatch(
      toolCalls: readonly ToolCall[],
      sessionId: string | undefined,
      opts: ToolExecOpts,
      toolLookup: ToolLookup
    ): Effect.Effect<PreparedToolBatch> {
      return Effect.gen(function* () {
        const prepared: PreparedToolCall[] = [];
        const denied: ToolResult[] = [];
        const escalations: PreparedToolBatch['escalations'] = [];
        if (!opts.projectPath) {
          return {
            prepared,
            denied: toolCalls.map((call) => ({
              status: 'denied' as const,
              id: call.id,
              name: call.name,
              reason: 'projectPath is required for sandboxed execution',
            })),
            escalations,
          };
        }
        for (const call of toolCalls) {
          const parsed = yield* Effect.either(parseCall(call, toolLookup));
          if (parsed._tag === 'Left') {
            denied.push({ status: 'denied', id: call.id, name: call.name, reason: parsed.left.message });
            continue;
          }
          const resolution = resolveSandboxPolicy({
            projectPath: opts.projectPath,
            sessionId: sessionId ?? '',
            permissionMode: opts.permissionMode ?? 'askBeforeExec',
            requestedMode: opts.sandboxMode,
            parentPolicy: opts.parentPolicy,
            operation: parsed.right.operation,
            parsedArgs: parsed.right.parsedArgs,
            callId: call.id,
            toolName: call.name,
            argsHash: parsed.right.argsHash,
          });
          if (resolution.kind === 'deny') {
            denied.push({ status: 'denied', id: call.id, name: call.name, reason: resolution.reason });
            continue;
          }
          if (resolution.kind === 'escalation') {
            escalations.push({
              prepared: { ...parsed.right, sandboxPolicy: resolution.policy },
              request: resolution.request,
            });
            continue;
          }
          prepared.push({ ...parsed.right, sandboxPolicy: resolution.policy });
        }
        return { prepared, denied, escalations };
      });
    }

    function executePrepared(
      prepared: PreparedToolCall,
      opts: ToolExecCall
    ): Effect.Effect<{ output: string }, AgentError> {
      return Effect.gen(function* () {
        const { call, runner, parsedArgs } = prepared;
        const finalArgs = parsedArgs as Record<string, unknown>;
        yield* hooks.emit('tool.execute.before', {
          toolName: call.name,
          args: finalArgs,
          sessionId: opts.sessionId,
          turnId: opts.turnId,
          projectPath: opts.projectPath,
          callId: call.id,
        });

        const start = Date.now();
        const ctx: ToolExecCtx = {
          ...toToolCtx(opts),
          sandboxPolicy: prepared.sandboxPolicy,
        };
        let toolEffect = runner.execute(parsedArgs, ctx);

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
          toolName: call.name,
          args: finalArgs,
          result,
          durationMs: Date.now() - start,
          sessionId: opts.sessionId,
          turnId: opts.turnId,
          projectPath: opts.projectPath,
          callId: call.id,
        });
        return { output: result };
      }).pipe(
        Effect.tapError((error) =>
          hooks.emit('tool.execute.error', {
            toolName: prepared.call.name,
            args: prepared.parsedArgs as Record<string, unknown>,
            error,
            projectPath: opts.projectPath,
          })
        )
      );
    }

    function executePreparedCall(
      prepared: PreparedToolCall,
      sessionId: string | undefined,
      opts: ToolExecOpts
    ): Effect.Effect<ToolResult> {
      return executePrepared(prepared, { sessionId, callId: prepared.call.id, ...opts }).pipe(
        Effect.matchEffect({
          onSuccess: (result): Effect.Effect<ToolResult> =>
            Effect.succeed({
              status: 'ok',
              id: prepared.call.id,
              name: prepared.call.name,
              output: result.output,
            }),
          onFailure: (error): Effect.Effect<ToolResult> => {
            if (
              error instanceof AgentError &&
              (error.code === 'TOOL_NOT_ALLOWED' || error.code.startsWith('SANDBOX_'))
            ) {
              return Effect.succeed({
                status: 'denied',
                id: prepared.call.id,
                name: prepared.call.name,
                reason: error.message,
              });
            }
            const code = error instanceof AgentError ? error.code : 'TOOL_EXECUTION_FAILED';
            const message = error instanceof AgentError ? error.message : String(error);
            return Effect.succeed({
              status: 'error',
              id: prepared.call.id,
              name: prepared.call.name,
              output: `[Error: ${code}] ${message}`,
            });
          },
        }),
        Effect.catchAllDefect((defect) =>
          Effect.succeed({
            status: 'error' as const,
            id: prepared.call.id,
            name: prepared.call.name,
            output: `[Unexpected] ${String(defect)}`,
          })
        )
      );
    }

    function splitWaves(toolCalls: readonly PreparedToolCall[]): PreparedToolCall[][] {
      const waves: PreparedToolCall[][] = [];
      let current: PreparedToolCall[] | undefined;
      for (const prepared of toolCalls) {
        if (prepared.runner.concurrencySafe) {
          if (!current) {
            current = [];
            waves.push(current);
          }
          current.push(prepared);
        } else {
          waves.push([prepared]);
          current = undefined;
        }
      }
      return waves;
    }

    function executeBatch(
      toolCalls: readonly (PreparedToolCall | ToolCall)[],
      sessionId: string | undefined,
      opts: ToolExecOpts,
      toolLookup?: ToolLookup
    ): Effect.Effect<ToolResult[], AgentError> {
      return Effect.gen(function* () {
        const preparedCalls: PreparedToolCall[] = [];
        for (const call of toolCalls) {
          if ('runner' in call) {
            preparedCalls.push(call);
            continue;
          }
          if (!toolLookup) {
            return yield* Effect.fail(AgentError.toolNotFound(call.name));
          }
          const parsed = yield* parseCall(call, toolLookup);
          preparedCalls.push({
            ...parsed,
            sandboxPolicy: compatibilityPolicy(opts.projectPath, sessionId),
          });
        }
        const runTool = (prepared: PreparedToolCall): Effect.Effect<ToolResult> =>
          Effect.suspend(() =>
            opts.signal?.aborted
              ? Effect.succeed({
                  status: 'denied',
                  id: prepared.call.id,
                  name: prepared.call.name,
                  reason: 'aborted',
                })
              : executePreparedCall(prepared, sessionId, opts)
          );

        const waveResults = yield* Effect.forEach(
          splitWaves(preparedCalls),
          (wave) => Effect.forEach(wave, runTool, { concurrency: 'unbounded' }),
          { concurrency: 1 }
        );

        const byId = new Map<string, ToolResult>();
        for (const wave of waveResults) for (const result of wave) byId.set(result.id, result);
        return preparedCalls.map((prepared) => byId.get(prepared.call.id)!);
      });
    }

    function prepare(mcpTools: McpToolSpec[] = []): Effect.Effect<ToolCatalog> {
      return Effect.sync(() => createToolCatalog(mcpTools));
    }

    return { prepare, parseCall, prepareBatch, executeBatch };
  })
);
