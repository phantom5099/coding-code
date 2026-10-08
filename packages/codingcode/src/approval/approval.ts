import { Layer, Effect } from 'effect';
import { HookService } from '../hooks/port.js';
import type { HookShape } from '../hooks/port.js';
import {
  ASK_BEFORE_EXEC_PERMISSION_MODE,
  BYPASS_PERMISSION_MODE,
  PLAN_PROFILE_NAME,
  type PermissionMode,
  type ProfileName,
} from '../util/enums.js';
import type { PermissionRule, ToolCallRequest } from './types.js';
import { PLAN_ALLOWED_TOOLS } from './tool-policy.js';
import { createRuleEngine, type RuleEngine } from './rule-engine.js';
import { userConfirmAsync } from './confirmation.js';
import { ApprovalWaitService } from './wait-port.js';
import { EventSinkService } from '../sink/port.js';
import { ApprovalService } from './port.js';
import type { ApprovalDecision, ApprovalRequest } from './port.js';

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
  if (profile === PLAN_PROFILE_NAME) {
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
    case BYPASS_PERMISSION_MODE:
      return { type: 'allow', source: 'permission-mode' };

    case ASK_BEFORE_EXEC_PERMISSION_MODE:
      if (!destructiveTools.has(tool)) {
        return { type: 'allow', source: 'permission-mode' };
      }
      return null;

    default:
      return null;
  }
}

function recordAuditAndReturn(
  hooks: HookShape,
  request: ToolCallRequest,
  decision: ApprovalDecision,
  passedLayers: string[],
  projectPath: string | undefined
): Effect.Effect<ApprovalDecision> {
  return Effect.gen(function* () {
    passedLayers.push(LAYER_NAMES[4]);
    yield* hooks.emit('tool.approval.post', {
      tool: request.tool,
      input: request.input,
      decision,
      layers: passedLayers,
      projectPath,
    });
    return decision;
  });
}

export function runPipeline(
  request: ToolCallRequest,
  opts: PipelineOptions
): Effect.Effect<ApprovalDecision, never, HookService | EventSinkService | ApprovalWaitService> {
  return Effect.gen(function* () {
    const hooks = yield* HookService;
    const layers: string[] = [];

    // Layer 1: Rule Engine
    {
      const result = opts.ruleEngine.evaluate(request.tool, request.input);
      if (result) {
        layers.push(LAYER_NAMES[0]);
        const final = yield* recordAuditAndReturn(hooks, request, result, layers, opts.projectPath);
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
        const final = yield* recordAuditAndReturn(
          hooks,
          request,
          modeResult,
          layers,
          opts.projectPath
        );
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
          const final = yield* recordAuditAndReturn(
            hooks,
            request,
            result,
            layers,
            opts.projectPath
          );
          return final;
        }
        if (hookResult.decision === 'allow') {
          const result: ApprovalDecision = { type: 'allow', source: 'hook' };
          const final = yield* recordAuditAndReturn(
            hooks,
            request,
            result,
            layers,
            opts.projectPath
          );
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

      const final = yield* recordAuditAndReturn(hooks, request, result, layers, opts.projectPath);
      return final;
    }
  });
}

export const ApprovalLayer = Layer.effect(
  ApprovalService,
  Effect.gen(function* () {
    const hooks = yield* HookService;
    const sink = yield* EventSinkService;
    const approvalWait = yield* ApprovalWaitService;
    const ruleEngine: RuleEngine = createRuleEngine();
    const destructiveTools = new Set(DANGEROUS_TOOL_NAMES);

    return {
      evaluate: (request: ApprovalRequest): Effect.Effect<ApprovalDecision> =>
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
            permissionMode: request.permissionMode ?? ASK_BEFORE_EXEC_PERMISSION_MODE,
            profile: request.profile,
            onAlways: (rule) => ruleEngine.addRule(rule),
            onNever: (rule) => ruleEngine.addRule(rule),
            sessionId: request.sessionId,
            projectPath: request.projectPath,
            callId: request.callId,
          }
        ).pipe(
          Effect.provideService(HookService, hooks),
          Effect.provideService(EventSinkService, sink),
          Effect.provideService(ApprovalWaitService, approvalWait)
        ),
    };
  })
);
