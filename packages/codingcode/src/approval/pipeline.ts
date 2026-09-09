import { Effect } from 'effect';
import type { ApprovalDecision, ApprovalProfile, PermissionMode, PermissionRule, ToolCallRequest } from './types.js';
import { PLAN_ALLOWED_TOOLS } from './types.js';
import type { RuleEngine } from './rule-engine.js';
import { userConfirmAsync } from './confirmation.js';
import { ApprovalWaitService } from './wait-port.js';
import { HookService } from '../hooks/port.js';

export interface PipelineOptions {
  ruleEngine: RuleEngine;
  destructiveTools: Set<string>;
  permissionMode: PermissionMode;
  /** Active agent profile — plan profile enforces its own allow-list in Layer 2. */
  profile?: ApprovalProfile;
  /** Called when user selects Always — allows caller to persist the rule. */
  onAlways?: (rule: PermissionRule) => void;
  /** Called when user selects Never — allows caller to persist the rule. */
  onNever?: (rule: PermissionRule) => void;
  /** Session ID for session-scoped approval routing. */
  sessionId: string;
  /** Project path for session-scoped approval routing (used by decision hooks
   *  that need to inspect the session's runtime state). */
  projectPath?: string;
  /** Optional LLM ToolCall ID to use as approval request ID. */
  callId?: string;
}

const LAYER_NAMES = [
  'RuleEngine',
  'PermissionMode',
  'HookPreToolUse',
  'UserConfirmation',
  'AuditLog',
] as const;

export function runPipeline(
  request: ToolCallRequest,
  opts: PipelineOptions
): any {
  return Effect.gen(function* () {
    const hooks: any = yield* HookService;
    const approvalWait: any = yield* ApprovalWaitService;
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

    // Layer 2: Permission Mode — the single auto-allow gate. Read-only tools
    {
      const modeResult = applyPermissionMode(
        request.tool,
        opts.permissionMode,
        opts.profile,
        opts.destructiveTools
      );
      if (modeResult) {
        layers.push(LAYER_NAMES[1]);
        const final = yield* recordAuditAndReturn(hooks, request, modeResult, layers);
        return final;
      }
    }

    // Layer 3: Hook PreToolUse
    {
      const hookResult = yield* Effect.gen(function* () {
        const result = yield* hooks.emitDecision('tool.approval.pre', {
          toolName: request.tool,
          args: request.input,
          sessionId: opts.sessionId,
          projectPath: opts.projectPath,
        });
        if (result && result.decision === 'continue') {
          return null;
        }
        return result;
      });
      if (hookResult) {
        layers.push(LAYER_NAMES[2]);
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
        request = nextRequest;
      }
    }

    // Layer 4: User Confirmation
    {
      layers.push(LAYER_NAMES[3]);

      if (!asyncConfirm) {
        const result: ApprovalDecision = {
          type: 'deny',
          reason: 'Approval required but no UI available',
          source: 'system',
        };
        const final = yield* recordAuditAndReturn(hooks, request, result, layers);
        return final;
      }

      const confirmResult = yield* userConfirmAsync(
        request.tool,
        request.input,
        opts.sessionId,
        opts.callId ?? ''
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
      }

      const final = yield* recordAuditAndReturn(hooks, request, result, layers);
      return final;
    }
  });
}

function applyPermissionMode(
  tool: string,
  mode: PermissionMode,
  profile: ApprovalProfile | undefined,
  destructiveTools: Set<string>
): ApprovalDecision | null {
  if (profile === 'plan') {
    if (PLAN_ALLOWED_TOOLS.has(tool)) {
      return { type: 'allow', source: 'permission-mode' };
    }
    return {
      type: 'deny',
      reason: 'Write operations denied in plan profile. Use submit_plan to submit a plan.',
      source: 'permission-mode',
    };
  }

  switch (mode) {
    case 'bypass':
      // Bypass mode: everything allowed (sandbox still restricts at OS level)
      return { type: 'allow', source: 'permission-mode' };

    case 'acceptEdits':
      // Accept edits: non-destructive tools (read-only + edit) auto-allow,
      // destructive tools need confirmation
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
  hooks: any,
  request: ToolCallRequest,
  decision: ApprovalDecision,
  passedLayers: string[]
): any {
  return Effect.gen(function* () {
    passedLayers.push(LAYER_NAMES[4]);
    yield* hooks.emit('tool.approval.post', {
      tool: request.tool,
      input: request.input,
      decision,
      layers: passedLayers,
    });
    return decision;
  });
}
