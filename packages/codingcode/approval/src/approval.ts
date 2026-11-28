import { Layer, Effect } from 'effect';
import { HOOK_POINT, HookService } from '@codingcode/hook';
import {
  ASK_BEFORE_EXEC_PERMISSION_MODE,
  BYPASS_PERMISSION_MODE,
  UNRESTRICTED_PERMISSION_MODE,
  type PermissionMode,
} from '@codingcode/util';
import { createRuleEngine, type RuleEngine } from './rule-engine.js';
import { userConfirmAsync } from './confirmation.js';
import { ApprovalWaitService } from './wait-port.js';
import { EventSinkService } from '@codingcode/sink';
import { ApprovalService, type ApprovalDecision, type ApprovalRequest } from './port.js';
import type { ToolApprovalMetadata } from '@codingcode/tool';
import type { ApprovalTarget } from './types.js';
import type { DangerousOperation, SandboxEscalationRequest } from '@codingcode/sandbox';
import type { SessionKey } from '@codingcode/session';

type ApprovalLayerName =
  | 'RuleEngine'
  | 'PermissionMode'
  | 'DangerousOperation'
  | 'HookPreToolUse'
  | 'UserConfirmation'
  | 'AuditLog';

const HARD_DANGERS: ReadonlySet<DangerousOperation> = new Set([
  'workspace_escape',
  'destructive_delete',
  'permission_change',
  'credential_access',
  'remote_code_fetch',
  'repository_history_write',
  'system_configuration',
]);

interface PipelineInput {
  readonly target: ApprovalTarget;
  readonly ruleEngine: RuleEngine;
  readonly permissionMode: PermissionMode;
  readonly operation: ToolApprovalMetadata;
  readonly session: SessionKey;
}

function runPipeline(
  input: PipelineInput
): Effect.Effect<ApprovalDecision, never, HookService | EventSinkService | ApprovalWaitService> {
  const { target, ruleEngine, permissionMode, operation, session } = input;
  return Effect.gen(function* () {
    const hooks = yield* HookService;
    const layers: ApprovalLayerName[] = [];

    const audit = (layer: ApprovalLayerName, decision: ApprovalDecision) =>
      Effect.gen(function* () {
        layers.push(layer, 'AuditLog');
        yield* hooks.emit(HOOK_POINT.TOOL_APPROVAL_POST, {
          tool: target.name,
          input: target.arguments,
          decision,
          layers,
          projectPath: session.cwd,
        });
        return decision;
      });

    if (permissionMode === UNRESTRICTED_PERMISSION_MODE) {
      return yield* audit('PermissionMode', { type: 'allow', source: 'unrestricted' });
    }

    if ((operation.dangerous ?? []).some((op) => HARD_DANGERS.has(op))) {
      return yield* audit('DangerousOperation', {
        type: 'deny',
        reason: 'Dangerous operation denied by policy',
        source: 'dangerous-operation',
      });
    }

    const ruleResult = ruleEngine.evaluate(target);
    if (ruleResult) {
      return yield* audit('RuleEngine', ruleResult);
    }

    if (permissionMode === BYPASS_PERMISSION_MODE) {
      return yield* audit('PermissionMode', { type: 'allow', source: 'permission-mode' });
    }

    const hookResult = yield* hooks.emitDecision(HOOK_POINT.TOOL_APPROVAL_PRE, {
      toolName: target.name,
      args: target.arguments,
      sessionId: session.sessionId,
      projectPath: session.cwd,
    });
    if (hookResult?.decision === 'deny') {
      return yield* audit('HookPreToolUse', {
        type: 'deny',
        reason: hookResult.reason ?? 'Denied by PreToolUse hook',
        source: 'hook',
      });
    }
    if (hookResult?.decision === 'allow') {
      return yield* audit('HookPreToolUse', { type: 'allow', source: 'hook' });
    }

    if (!operation.requiresConfirmation) {
      return yield* audit('PermissionMode', { type: 'allow', source: 'permission-mode' });
    }

    const confirmResult = yield* userConfirmAsync({
      target,
      sessionId: session.sessionId,
      action: operation.action,
    });
    return yield* audit(
      'UserConfirmation',
      confirmResult.type === 'allow'
        ? { type: 'allow', source: 'user-confirm' }
        : { type: 'deny', reason: 'Denied by user', source: 'user-confirm' }
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

    const provideDeps = (
      eff: Effect.Effect<ApprovalDecision, never, HookService | EventSinkService | ApprovalWaitService>
    ): Effect.Effect<ApprovalDecision> =>
      eff.pipe(
        Effect.provideService(HookService, hooks),
        Effect.provideService(EventSinkService, sink),
        Effect.provideService(ApprovalWaitService, approvalWait)
      );

    const evaluate = (request: ApprovalRequest): Effect.Effect<ApprovalDecision> =>
      provideDeps(
        runPipeline({
          target: {
            id: request.prepared.call.id,
            name: request.prepared.call.name,
            arguments: request.prepared.parsedArgs,
          },
          ruleEngine,
          permissionMode: request.permissionMode ?? ASK_BEFORE_EXEC_PERMISSION_MODE,
          operation: request.prepared.operation,
          session: request.session,
        })
      );

    const evaluateBatch = (requests: readonly ApprovalRequest[]): Effect.Effect<ApprovalDecision[]> =>
      Effect.forEach(requests, evaluate, { concurrency: 1 });

    const evaluateEscalation = (
      request: SandboxEscalationRequest
    ): Effect.Effect<ApprovalDecision> =>
      provideDeps(
        runPipeline({
          target: {
            id: request.call.callId,
            name: request.call.toolName,
            arguments: {
              currentMode: request.currentMode,
              targetMode: request.targetMode,
              additionalWritableRoots: request.additionalWritableRoots ?? [],
              justification: request.justification,
            },
          },
          ruleEngine,
          permissionMode: ASK_BEFORE_EXEC_PERMISSION_MODE,
          operation: { action: 'sandbox', requiresConfirmation: true },
          session: { cwd: request.workspaceRoot, sessionId: request.sessionId },
        })
      );

    const evaluateEscalationBatch = (
      requests: readonly SandboxEscalationRequest[]
    ): Effect.Effect<ApprovalDecision[]> =>
      Effect.forEach(requests, evaluateEscalation, { concurrency: 1 });

    return { evaluate, evaluateBatch, evaluateEscalation, evaluateEscalationBatch };
  })
);
