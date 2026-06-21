import { Effect } from 'effect';
import type { ApprovalDecision, PermissionMode, PermissionRule, ToolCallRequest } from './types.js';
import type { RuleEngine } from './rule-engine.js';
import { userConfirmAsync } from './confirmation.js';
import { ApprovalWaitService } from './async-confirm.js';
import { HookService } from '../hooks/registry.js';

export interface PipelineOptions {
  ruleEngine: RuleEngine;
  readonlyTools: Set<string>;
  destructiveTools: Set<string>;
  permissionMode: PermissionMode;
  /** Called when user selects Always — allows caller to persist the rule. */
  onAlways?: (rule: PermissionRule) => void;
  /** Called when user selects Never — allows caller to persist the rule. */
  onNever?: (rule: PermissionRule) => void;
  /** Session ID for session-scoped approval routing. */
  sessionId: string;
  /** Optional LLM ToolCall ID to use as approval request ID. */
  callId?: string;
}

const LAYER_NAMES = [
  'RuleEngine',
  'ReadonlyWhitelist',
  'PermissionMode',
  'HookPreToolUse',
  'UserConfirmation',
  'AuditLog',
] as const;

export function runPipeline(
  request: ToolCallRequest,
  opts: PipelineOptions
): Effect.Effect<ApprovalDecision, never, HookService | ApprovalWaitService> {
  return Effect.gen(function* () {
    const hooks = yield* HookService;
    const approvalWait = yield* ApprovalWaitService;
    const asyncConfirm = yield* approvalWait.hasEmitter(opts.sessionId);
    const layers: string[] = [];

    // Layer 1: Rule Engine
    {
      const result = opts.ruleEngine.evaluate(request.tool, request.input);
      if (result) {
        layers.push(LAYER_NAMES[0]);
        const final = yield* recordAuditAndReturn(hooks, request, result, layers);
        return final;
      }
    }

    // Layer 2: Read-only Whitelist
    {
      if (opts.readonlyTools.has(request.tool)) {
        const result: ApprovalDecision = {
          type: 'allow',
          source: 'readonly-whitelist',
        };
        layers.push(LAYER_NAMES[1]);
        const final = yield* recordAuditAndReturn(hooks, request, result, layers);
        return final;
      }
    }

    // Layer 3: Permission Mode
    {
      const modeResult = applyPermissionMode(
        request.tool,
        opts.permissionMode,
        opts.readonlyTools,
        opts.destructiveTools
      );
      if (modeResult) {
        layers.push(LAYER_NAMES[2]);
        const final = yield* recordAuditAndReturn(hooks, request, modeResult, layers);
        return final;
      }
    }

    // Layer 4: Hook PreToolUse
    {
      const hookResult = yield* Effect.gen(function* () {
        const result = yield* hooks.emitDecision('tool.approval.pre', {
          toolName: request.tool,
          args: request.input,
        });
        if (result && result.decision === 'continue') {
          return null;
        }
        return result;
      });
      if (hookResult) {
        layers.push(LAYER_NAMES[3]);
        if (hookResult.decision === 'deny') {
          const result: ApprovalDecision = {
            type: 'deny',
            reason: hookResult.reason ?? 'Denied by PreToolUse hook',
            source: 'hook',
          };
          const final = yield* recordAuditAndReturn(hooks, request, result, layers);
          return final;
        }
        if (hookResult.decision === 'allow') {
          const result: ApprovalDecision = { type: 'allow', source: 'hook' };
          const final = yield* recordAuditAndReturn(hooks, request, result, layers);
          return final;
        }
        // 'ask' or no decision → continue to user confirmation
        const nextRequest: ToolCallRequest = { ...request };
        if (hookResult.modifiedInput) {
          nextRequest.input = hookResult.modifiedInput;
        }
        if (hookResult.payload) {
          nextRequest.context = {
            ...(nextRequest.context ?? {}),
            _plan_approval_payload: hookResult.payload,
          };
        }
        request = nextRequest;
      }
    }

    // Layer 5: User Confirmation
    {
      layers.push(LAYER_NAMES[4]);
      if (!asyncConfirm) {
        const result: ApprovalDecision = {
          type: 'deny',
          reason: 'Approval required but no UI available',
          source: 'system',
        };
        const final = yield* recordAuditAndReturn(hooks, request, result, layers);
        return final;
      }

      const confirmPayload = (request.context as { _plan_approval_payload?: Record<string, unknown> } | undefined)?._plan_approval_payload;

      const confirmResult = yield* userConfirmAsync(
        request.tool,
        request.input,
        opts.sessionId,
        opts.callId ?? '',
        confirmPayload
      );

      let result: ApprovalDecision;
      switch (confirmResult.type) {
        case 'allow':
          result = { type: 'allow', source: 'user-confirm' };
          break;
        case 'deny':
          result = { type: 'deny', reason: 'Denied by user', source: 'user-confirm' };
          break;
        case 'always':
          opts.onAlways?.(confirmResult.rule);
          result = { type: 'allow', source: 'user-confirm' };
          break;
        case 'never':
          opts.onNever?.(confirmResult.rule);
          result = { type: 'deny', reason: 'Never allow for this tool', source: 'user-confirm' };
          break;
        case 'modified':
          // User revised the input (e.g. plan content) — re-execute with new input
          result = {
            type: 'modified',
            input: confirmResult.input,
            source: 'user-confirm',
          };
          break;
        case 'canceled':
          // User explicitly canceled the approval (e.g. "Cancel" on plan approval modal)
          result = {
            type: 'deny',
            reason: 'User canceled the plan approval',
            source: 'user-canceled',
          };
          break;
      }

      const final = yield* recordAuditAndReturn(hooks, request, result, layers);
      return final;
    }
  });
}

function applyPermissionMode(
  tool: string,
  mode: PermissionMode,
  readonlyTools: Set<string>,
  destructiveTools: Set<string>
): ApprovalDecision | null {
  switch (mode) {
    case 'plan':
      if (tool === 'submit_plan') {
        return null;
      }
      return {
        type: 'deny',
        reason: 'Write operations denied in plan mode. Use submit_plan to submit a plan.',
        source: 'permission-mode',
      };

    case 'bypass':
      // Bypass mode: everything allowed (sandbox still restricts at OS level)
      return { type: 'allow', source: 'permission-mode' };

    case 'acceptEdits':
      // Accept edits: read-only + edit tools auto-allow, destructive tools need confirmation
      if (!destructiveTools.has(tool)) {
        return { type: 'allow', source: 'permission-mode' };
      }
      return null; // Continue to next layers

    case 'default':
    default:
      return null; // Continue to next layers
  }
}

function recordAuditAndReturn(
  hooks: HookService,
  request: ToolCallRequest,
  decision: ApprovalDecision,
  passedLayers: string[]
): Effect.Effect<ApprovalDecision, never, HookService> {
  return Effect.gen(function* () {
    passedLayers.push(LAYER_NAMES[5]);
    yield* hooks.emit('tool.approval.post', {
      tool: request.tool,
      input: request.input,
      decision,
      layers: passedLayers,
    });
    return decision;
  });
}
