import { Layer, Effect } from 'effect';
import { HookService } from '../hooks/port.js';
import type { PermissionMode, PermissionRule, ApprovalDecision } from './types.js';
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

    function makeForkedService(
      engine: RuleEngine,
      permMode: PermissionMode,
      destTools: Set<string>
    ): any {
      return {
        evaluate: (request: {
          tool: string;
          input: Record<string, unknown>;
          context?: Record<string, unknown>;
          callId?: string;
          sessionId: string;
          projectPath?: string;
        }): any =>
          runPipeline(
            {
              tool: request.tool,
              input: request.input,
              context: request.context,
              callId: request.callId,
            },
            {
              ruleEngine: engine,
              destructiveTools: destTools,
              permissionMode: permMode,
              onAlways: (rule) => engine.addRule(rule),
              onNever: (rule) => engine.addRule(rule),
              sessionId: request.sessionId,
              projectPath: request.projectPath,
              callId: request.callId,
            }
          ).pipe(
            Effect.provideService(HookService, hooks),
            Effect.provideService(ApprovalWaitService, approvalWait)
          ),
        fork: (opts?: {
          extraDenyRules?: PermissionRule[];
          readonly?: boolean;
          permissionMode?: PermissionMode;
        }): Effect.Effect<ApprovalService> =>
          Effect.sync(() => {
            const nextEngine = createRuleEngine(engine.getAllRules());
            if (opts?.extraDenyRules) {
              for (const rule of opts.extraDenyRules) {
                nextEngine.addRule(rule);
              }
            }
            if (opts?.readonly) {
              for (const toolName of DANGEROUS_TOOL_NAMES) {
                nextEngine.addRule({
                  id: `readonly-${toolName}`,
                  action: 'deny' as const,
                  toolPattern: toolName,
                  source: 'system' as const,
                });
              }
            }
            return makeForkedService(
              nextEngine,
              opts?.permissionMode ?? permMode,
              new Set(destTools)
            );
          }),
      };
    }

    return {
      evaluate: (request: {
        tool: string;
        input: Record<string, unknown>;
        context?: Record<string, unknown>;
        callId?: string;
        sessionId: string;
        projectPath?: string;
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
            permissionMode: 'default',
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

      fork: (opts?: {
        extraDenyRules?: PermissionRule[];
        readonly?: boolean;
        permissionMode?: PermissionMode;
      }): Effect.Effect<ApprovalService> =>
        Effect.sync(() => {
          const parentRules = ruleEngine.getAllRules();
          const childEngine = createRuleEngine(parentRules);
          if (opts?.extraDenyRules) {
            for (const rule of opts.extraDenyRules) {
              childEngine.addRule(rule);
            }
          }
          if (opts?.readonly) {
            const denyRules: PermissionRule[] = DANGEROUS_TOOL_NAMES.map((toolName) => ({
              id: `readonly-${toolName}`,
              action: 'deny' as const,
              toolPattern: toolName,
              source: 'system' as const,
            }));
            for (const rule of denyRules) {
              childEngine.addRule(rule);
            }
          }
          return makeForkedService(
            childEngine,
            opts?.permissionMode ?? 'default',
            new Set(destructiveTools)
          );
        }),
    };
} as any));
