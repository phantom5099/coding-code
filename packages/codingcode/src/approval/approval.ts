import { Layer, Effect } from 'effect';
import { HookService } from '../hooks/port.js';
import type { PermissionMode, ApprovalProfile } from './types.js';
import { createRuleEngine, type RuleEngine } from './rule-engine.js';
import { runPipeline } from './pipeline.js';
import { ApprovalWaitService } from './wait-port.js';
import { ApprovalService } from './port.js';

const DANGEROUS_TOOL_NAMES = ['execute_command'];

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
        profile?: ApprovalProfile;
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
