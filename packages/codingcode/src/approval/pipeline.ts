import { Effect } from 'effect';
import type { ApprovalDecision, PermissionMode, PermissionRule, ToolCallRequest } from './types';
import type { RuleEngine } from './rule-engine';
import { userConfirm, userConfirmAsync } from './confirmation';
import type { ApprovalWaitService } from './async-confirm';

export interface PipelineHooks {
  /** Emit decision from PreToolUse hooks (Layer 4). Returns first non-null HookDecision or null. */
  emitPreToolUseDecision: (payload: {
    toolName: string;
    args: Record<string, unknown>;
  }) => Effect.Effect<{
    decision?: 'allow' | 'deny' | 'ask';
    reason?: string;
    modifiedInput?: Record<string, unknown>;
  } | null>;
  /** Record audit log for the final decision (Layer 6). */
  recordAudit: (entry: {
    tool: string;
    input: Record<string, unknown>;
    decision: ApprovalDecision;
    layers: string[];
  }) => Effect.Effect<void>;
}

export interface PipelineOptions {
  ruleEngine: RuleEngine;
  readonlyTools: Set<string>;
  destructiveTools: Set<string>;
  permissionMode: PermissionMode;
  hooks: PipelineHooks;
  /** Whether TTY is available for interactive confirmation. */
  interactive: boolean;
  /** Use async SSE-based confirmation instead of blocking readline. */
  asyncConfirm?: boolean;
  /** Service for async confirmation (injected to keep R clean). */
  asyncConfirmService?: ApprovalWaitService;
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
): Effect.Effect<ApprovalDecision> {
  return Effect.gen(function* () {
    const layers: string[] = [];

    // Layer 1: Rule Engine
    {
      const result = opts.ruleEngine.evaluate(request.tool, request.input);
      if (result) {
        layers.push(LAYER_NAMES[0]);
        const final = yield* layer6Audit(request, result, layers, opts);
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
        const final = yield* layer6Audit(request, result, layers, opts);
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
        const final = yield* layer6Audit(request, modeResult, layers, opts);
        return final;
      }
    }

    // Layer 4: Hook PreToolUse
    {
      const hookResult = yield* opts.hooks.emitPreToolUseDecision({
        toolName: request.tool,
        args: request.input,
      });
      if (hookResult) {
        layers.push(LAYER_NAMES[3]);
        if (hookResult.decision === 'deny') {
          const result: ApprovalDecision = {
            type: 'deny',
            reason: hookResult.reason ?? 'Denied by PreToolUse hook',
            source: 'hook',
          };
          const final = yield* layer6Audit(request, result, layers, opts);
          return final;
        }
        if (hookResult.decision === 'allow') {
          const result: ApprovalDecision = { type: 'allow', source: 'hook' };
          const final = yield* layer6Audit(request, result, layers, opts);
          return final;
        }
        // 'ask' or no decision → continue to user confirmation
        if (hookResult.modifiedInput) {
          // Use modified input for user confirmation
          request = { ...request, input: hookResult.modifiedInput };
        }
      }
    }

    // Layer 5: User Confirmation
    {
      layers.push(LAYER_NAMES[4]);
      const confirmResult = yield* opts.asyncConfirm && opts.asyncConfirmService
        ? userConfirmAsync(
            request.tool,
            request.input,
            opts.asyncConfirmService,
            opts.sessionId,
            opts.callId
          )
        : userConfirm(
            request.tool,
            request.input,
            opts.interactive ? 'interactive' : 'default-deny'
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

      const final = yield* layer6Audit(request, result, layers, opts);
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
      // Plan mode: only read-only tools allowed
      if (!readonlyTools.has(tool)) {
        return {
          type: 'deny',
          reason: 'Write operations denied in plan mode',
          source: 'permission-mode',
        };
      }
      return { type: 'allow', source: 'permission-mode' };

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

function layer6Audit(
  request: ToolCallRequest,
  decision: ApprovalDecision,
  passedLayers: string[],
  opts: PipelineOptions
): Effect.Effect<ApprovalDecision> {
  return Effect.gen(function* () {
    passedLayers.push(LAYER_NAMES[5]);
    yield* opts.hooks.recordAudit({
      tool: request.tool,
      input: request.input,
      decision,
      layers: passedLayers,
    });
    return decision;
  });
}
