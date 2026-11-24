import { Layer, Effect } from 'effect';
import { HookService } from '../hooks/port.js';
import type { HookShape } from '../hooks/port.js';
import {
  ASK_BEFORE_EXEC_PERMISSION_MODE,
  BYPASS_PERMISSION_MODE,
  UNRESTRICTED_PERMISSION_MODE,
  type PermissionMode,
} from '../util/enums.js';
import { createRuleEngine } from './rule-engine.js';
import { userConfirmAsync } from './confirmation.js';
import { ApprovalWaitService } from './wait-port.js';
import { EventSinkService } from '../sink/port.js';
import { ApprovalService } from './port.js';
import type { ApprovalDecision, ApprovalRequest } from './port.js';
import type { ToolApprovalMetadata } from '../tools/types.js';
import type { ToolCallRequest } from './types.js';
import type { SandboxEscalationRequest } from '../sandbox/types.js';

const LAYER_NAMES = ['RuleEngine', 'PermissionMode', 'HookPreToolUse', 'UserConfirmation', 'AuditLog'] as const;
const HARD_DANGERS = new Set([
  'workspace_escape',
  'destructive_delete',
  'permission_change',
  'credential_access',
  'remote_code_fetch',
  'repository_history_write',
  'system_configuration',
]);

interface PipelineOptions {
  ruleEngine: ReturnType<typeof createRuleEngine>;
  permissionMode: PermissionMode;
  operation: ToolApprovalMetadata;
  sessionId: string;
  projectPath?: string;
  callId?: string;
}

function recordAuditAndReturn(
  hooks: HookShape,
  request: ToolCallRequest,
  decision: ApprovalDecision,
  layers: string[],
  projectPath?: string
) {
  return Effect.gen(function* () {
    layers.push(LAYER_NAMES[4]);
    yield* hooks.emit('tool.approval.post', {
      tool: request.tool,
      input: request.input,
      decision,
      layers,
      projectPath,
    });
    return decision;
  });
}

function runPipeline(
  request: ToolCallRequest,
  opts: PipelineOptions
): Effect.Effect<ApprovalDecision, never, HookService | EventSinkService | ApprovalWaitService> {
  return Effect.gen(function* () {
    const hooks = yield* HookService;
    const layers: string[] = [];

    if (opts.permissionMode === UNRESTRICTED_PERMISSION_MODE) {
      layers.push('PermissionMode');
      return yield* recordAuditAndReturn(
        hooks,
        request,
        { type: 'allow', source: 'unrestricted' },
        layers,
        opts.projectPath
      );
    }

    if (
      (opts.operation.dangerous ?? []).some((operation) => HARD_DANGERS.has(operation))
    ) {
      layers.push('DangerousOperation');
      return yield* recordAuditAndReturn(
        hooks,
        request,
        {
          type: 'deny',
          reason: 'Dangerous operation denied by policy',
          source: 'dangerous-operation',
        },
        layers,
        opts.projectPath
      );
    }

    const ruleResult = opts.ruleEngine.evaluate(request.tool, request.input);
    if (ruleResult) {
      layers.push(LAYER_NAMES[0]);
      return yield* recordAuditAndReturn(hooks, request, ruleResult, layers, opts.projectPath);
    }

    if (
      opts.permissionMode === BYPASS_PERMISSION_MODE
    ) {
      layers.push(LAYER_NAMES[1]);
      return yield* recordAuditAndReturn(
        hooks,
        request,
        { type: 'allow', source: 'permission-mode' },
        layers,
        opts.projectPath
      );
    }

    const hookResult = yield* hooks.emitDecision('tool.approval.pre', {
      toolName: request.tool,
      args: request.input,
      sessionId: opts.sessionId,
      projectPath: opts.projectPath,
    });
    if (hookResult?.decision === 'deny') {
      layers.push(LAYER_NAMES[2]);
      return yield* recordAuditAndReturn(
        hooks,
        request,
        {
          type: 'deny',
          reason: hookResult.reason ?? 'Denied by PreToolUse hook',
          source: 'hook',
        },
        layers,
        opts.projectPath
      );
    }
    if (hookResult?.decision === 'allow') {
      layers.push(LAYER_NAMES[2]);
      return yield* recordAuditAndReturn(
        hooks,
        request,
        { type: 'allow', source: 'hook' },
        layers,
        opts.projectPath
      );
    }

    if (!opts.operation.requiresConfirmation) {
      layers.push(LAYER_NAMES[1]);
      return yield* recordAuditAndReturn(
        hooks,
        request,
        { type: 'allow', source: 'permission-mode' },
        layers,
        opts.projectPath
      );
    }

    layers.push(LAYER_NAMES[3]);
    const confirmResult = yield* userConfirmAsync(
      request.tool,
      request.input,
      opts.sessionId,
      opts.callId ?? '',
      opts.operation.action
    );
    return yield* recordAuditAndReturn(
      hooks,
      request,
      confirmResult.type === 'allow'
        ? { type: 'allow', source: 'user-confirm' }
        : { type: 'deny', reason: 'Denied by user', source: 'user-confirm' },
      layers,
      opts.projectPath
    );
  });
}

export const ApprovalLayer = Layer.effect(
  ApprovalService,
  Effect.gen(function* () {
    const hooks = yield* HookService;
    const sink = yield* EventSinkService;
    const approvalWait = yield* ApprovalWaitService;
    const ruleEngine = createRuleEngine();

    const evaluate = (request: ApprovalRequest): Effect.Effect<ApprovalDecision> => {
      const operation = request.prepared.operation;
      return runPipeline(
        {
          tool: request.tool,
          input: request.input,
          context: request.context,
          callId: request.callId,
        },
        {
          ruleEngine,
          permissionMode: request.permissionMode ?? ASK_BEFORE_EXEC_PERMISSION_MODE,
          operation,
          sessionId: request.sessionId,
          projectPath: request.projectPath,
          callId: request.callId,
        }
      ).pipe(
        Effect.provideService(HookService, hooks),
        Effect.provideService(EventSinkService, sink),
        Effect.provideService(ApprovalWaitService, approvalWait)
      );
    };

    const evaluateBatch = (requests: readonly ApprovalRequest[]): Effect.Effect<ApprovalDecision[]> =>
      Effect.forEach(requests, evaluate, { concurrency: 1 });

    const evaluateEscalation = (
      request: SandboxEscalationRequest
    ): Effect.Effect<ApprovalDecision> =>
      runPipeline(
        {
          tool: request.toolName,
          input: {
            currentMode: request.currentMode,
            targetMode: request.targetMode,
            additionalWritableRoots: request.additionalWritableRoots ?? [],
            justification: request.justification,
          },
          callId: request.callId,
        },
        {
          ruleEngine,
          permissionMode: ASK_BEFORE_EXEC_PERMISSION_MODE,
          operation: { action: 'sandbox', requiresConfirmation: true },
          sessionId: request.sessionId,
          callId: request.callId,
        }
      ).pipe(
        Effect.provideService(HookService, hooks),
        Effect.provideService(EventSinkService, sink),
        Effect.provideService(ApprovalWaitService, approvalWait)
      );

    const evaluateEscalationBatch = (
      requests: readonly SandboxEscalationRequest[]
    ): Effect.Effect<ApprovalDecision[]> =>
      Effect.forEach(requests, evaluateEscalation, { concurrency: 1 });

    return { evaluate, evaluateBatch, evaluateEscalation, evaluateEscalationBatch };
  })
);
