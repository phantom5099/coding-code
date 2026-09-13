import { Layer, Effect } from 'effect';
import { HookService } from '../hooks/port.js';
import type { ApprovalDecision, PermissionMode, PermissionRule, ToolCallRequest } from './types.js';
import type { ProfileName } from '../core/types.js';
import { PLAN_ALLOWED_TOOLS } from './types.js';
import { createRuleEngine, type RuleEngine } from './rule-engine.js';
import { userConfirmAsync } from './confirmation.js';
import { ApprovalWaitService } from './wait-port.js';
import { ApprovalService } from './port.js';

const DANGEROUS_TOOL_NAMES = ['execute_command'];

const LAYER_NAMES = [
  'RuleEngine',
  'PermissionMode',
  'HookPreToolUse',
  'UserConfirmation',
  'AuditLog',
] as const;

interface PipelineOptions {
  ruleEngine: RuleEngine;
  destructiveTools: Set<string>;
  permissionMode: PermissionMode;
  profile?: ProfileName;
  onAlways?: (rule: PermissionRule) => void;
  onNever?: (rule: PermissionRule) => void;
  sessionId: string;
  projectPath?: string;
  callId?: string;
}

function applyPermissionMode(
  tool: string,
  mode: PermissionMode,
  profile: ProfileName | undefined,
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
      return { type: 'allow', source: 'permission-mode' };

    case 'acceptEdits':
      if (!destructiveTools.has(tool)) {
        return { type: 'allow', source: 'permission-mode' };
      }
      return null;

    case 'default':
    default:
      return null;
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

    // Layer 2: Permission Mode
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

export const ApprovalLayer = Layer.effect(ApprovalService, Effect.gen(function* () {
    const hooks = yield* HookService;
    const approvalWait = yield* ApprovalWaitService;
    const ruleEngine: RuleEngine = createRuleEngine();
    const destructiveTools = new Set(DANGEROUS_TOOL_NAMES);

    return {
      evaluate: (request: {
        tool: string;
        input: Record<string, unknown>;
        context?: Record<string, unknown>;
        callId?: string;
        sessionId: string;
        projectPath?: string;
        permissionMode?: PermissionMode;
        profile?: ProfileName;
      }): any =>
        runPipeline(
          {
            tool: request.tool,
            input: request.input,
            context: request.context,
            callId: request.callId,
          },
          {
            ruleEngine,
            destructiveTools,
            permissionMode: request.permissionMode ?? 'default',
            profile: request.profile,
            onAlways: (rule) => ruleEngine.addRule(rule),
            onNever: (rule) => ruleEngine.addRule(rule),
            sessionId: request.sessionId,
            projectPath: request.projectPath,
            callId: request.callId,
          }
        ).pipe(
          Effect.provideService(HookService, hooks),
          Effect.provideService(ApprovalWaitService, approvalWait)
        ),
    };
} as any));
