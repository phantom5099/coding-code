import { Layer, Effect } from 'effect';
import { createHash } from 'node:crypto';
import { AgentError, stableJson } from '@codingcode/util';
import { HOOK_POINT, HookService } from '@codingcode/hook';
import type { ToolCall } from '@codingcode/model';
import type { McpToolSpec } from '@codingcode/mcp';
import { sessionLocatorOf, type SessionKey } from '@codingcode/session';
import type {
  ExecuteToolBatchRequest,
  ParsedToolCall,
  PrepareToolBatchRequest,
  PreparedToolBatch,
  PreparedToolCall,
  ToolBatchContext,
  ToolCatalog,
  ToolExecCtx,
  ToolLookup,
  ToolResult,
} from './types.js';
import { resolveSandboxPolicy, type SandboxPolicy } from '@codingcode/sandbox';
import { ToolExecutorService, ToolRegistryService } from './port.js';
import { createToolCatalog } from './catalog.js';

/** 批次上下文 + 已就绪调用 → 单工具执行上下文（投影 SessionLocator，隔离 currentTurnId） */
function toToolCtx(batch: ToolBatchContext, prepared: PreparedToolCall): ToolExecCtx {
  return {
    session: sessionLocatorOf(batch.session),
    ...(batch.signal !== undefined ? { signal: batch.signal } : {}),
    ...(batch.agentName !== undefined ? { agentName: batch.agentName } : {}),
    callId: prepared.call.id,
    sandboxPolicy: prepared.sandboxPolicy,
    ...(batch.permissionMode !== undefined ? { permissionMode: batch.permissionMode } : {}),
    ...(batch.sandbox !== undefined ? { sandbox: batch.sandbox } : {}),
    model: batch.model,
  };
}

function argsHash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function unrestrictedFallbackPolicy(session: SessionKey): SandboxPolicy {
  if (!session.cwd) {
    throw new AgentError('SANDBOX_PATH_DENIED', 'projectPath is required for tool execution');
  }
  return {
    mode: 'unrestricted',
    workspaceRoot: session.cwd,
    additionalWritableRoots: [],
    network: { mode: 'unrestricted', hosts: [], ports: [] },
    sessionId: session.sessionId || 'compatibility',
    enforcement: 'disabled',
    fingerprint: 'compatibility',
  };
}

export const ToolExecutorLayer = Layer.effect(
  ToolExecutorService,
  Effect.gen(function* () {
    const hooks = yield* HookService;
    const registry = yield* ToolRegistryService;

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

    function prepareBatch(req: PrepareToolBatchRequest): Effect.Effect<PreparedToolBatch> {
      const { toolCalls, context: ctx, toolLookup } = req;
      return Effect.gen(function* () {
        const prepared: PreparedToolCall[] = [];
        const denied: ToolResult[] = [];
        const escalations: PreparedToolBatch['escalations'] = [];
        if (!ctx.session.cwd) {
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
            projectPath: ctx.session.cwd,
            sessionId: ctx.session.sessionId,
            permissionMode: ctx.permissionMode ?? 'askBeforeExec',
            requestedMode: ctx.sandbox?.mode,
            parentPolicy: ctx.sandbox?.policy,
            operation: parsed.right.operation,
            call: {
              callId: call.id,
              toolName: call.name,
              argsHash: parsed.right.argsHash,
            },
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
      batchCtx: ToolBatchContext
    ): Effect.Effect<{ output: string }, AgentError> {
      return Effect.gen(function* () {
        const { call, runner, parsedArgs } = prepared;
        yield* hooks.emit(HOOK_POINT.TOOL_EXECUTE_BEFORE, {
          toolName: call.name,
          args: parsedArgs,
          sessionId: batchCtx.session.sessionId,
          turnId: batchCtx.session.currentTurnId,
          projectPath: batchCtx.session.cwd,
          callId: call.id,
        });

        const start = Date.now();
        const ctx = toToolCtx(batchCtx, prepared);
        let toolEffect = runner.execute(parsedArgs, ctx);

        if (batchCtx.signal) {
          if (batchCtx.signal.aborted) {
            return yield* Effect.fail(new AgentError('TOOL_NOT_ALLOWED', 'Tool execution aborted'));
          }
          toolEffect = Effect.raceFirst(
            toolEffect,
            Effect.async<string, AgentError>((resume) => {
              const onAbort = () =>
                resume(Effect.fail(new AgentError('TOOL_NOT_ALLOWED', 'Tool execution aborted')));
              batchCtx.signal!.addEventListener('abort', onAbort, { once: true });
              return Effect.sync(() => batchCtx.signal!.removeEventListener('abort', onAbort));
            })
          );
        }

        const result = yield* toolEffect;
        yield* hooks.emit(HOOK_POINT.TOOL_EXECUTE_AFTER, {
          toolName: call.name,
          args: parsedArgs,
          result,
          durationMs: Date.now() - start,
          sessionId: batchCtx.session.sessionId,
          turnId: batchCtx.session.currentTurnId,
          projectPath: batchCtx.session.cwd,
          callId: call.id,
        });
        return { output: result };
      }).pipe(
        Effect.tapError((error) =>
          hooks.emit(HOOK_POINT.TOOL_EXECUTE_ERROR, {
            toolName: prepared.call.name,
            args: prepared.parsedArgs,
            error,
            sessionId: batchCtx.session.sessionId,
            turnId: batchCtx.session.currentTurnId,
            projectPath: batchCtx.session.cwd,
            callId: prepared.call.id,
          })
        )
      );
    }

    function executePreparedCall(
      prepared: PreparedToolCall,
      ctx: ToolBatchContext
    ): Effect.Effect<ToolResult> {
      return executePrepared(prepared, ctx).pipe(
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

    function executeBatch(req: ExecuteToolBatchRequest): Effect.Effect<ToolResult[], AgentError> {
      const { toolCalls, context: ctx, toolLookup } = req;
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
            sandboxPolicy: unrestrictedFallbackPolicy(ctx.session),
          });
        }
        const runTool = (prepared: PreparedToolCall): Effect.Effect<ToolResult> =>
          Effect.suspend(() =>
            ctx.signal?.aborted
              ? Effect.succeed({
                  status: 'denied',
                  id: prepared.call.id,
                  name: prepared.call.name,
                  reason: 'aborted',
                })
              : executePreparedCall(prepared, ctx)
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
      return Effect.sync(() => createToolCatalog(registry.list(), mcpTools));
    }

    return { prepare, parseCall, prepareBatch, executeBatch };
  })
);
