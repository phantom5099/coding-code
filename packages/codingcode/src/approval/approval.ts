import { Layer, Effect } from 'effect';
import { HookService } from '../hooks/port.js';
import type { PermissionMode } from './types.js';
import { createRuleEngine, type RuleEngine } from './rule-engine.js';
import { DEFAULT_DENY_RULES, DANGEROUS_TOOL_NAMES } from './presets.js';
import { runPipeline } from './pipeline.js';
import { ApprovalWaitService } from './wait-port.js';
import { ApprovalService } from './port.js';

export const ApprovalLayer = Layer.effect(ApprovalService, Effect.gen(function* () {
    const hooks = yield* HookService;
    const approvalWait = yield* ApprovalWaitService;
    const ruleEngine: RuleEngine = createRuleEngine(DEFAULT_DENY_RULES);
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
