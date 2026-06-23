import { Effect } from 'effect';
import { HookService } from '../hooks/registry.js';
import type { PermissionMode, PermissionRule, ApprovalDecision } from './types.js';
import { createRuleEngine, type RuleEngine } from './rule-engine.js';
import { DEFAULT_DENY_RULES, READONLY_TOOL_NAMES, DANGEROUS_TOOL_NAMES } from './presets.js';
import { runPipeline } from './pipeline.js';
import { ApprovalWaitService } from './async-confirm.js';

export class ApprovalService extends Effect.Service<ApprovalService>()('Approval', {
  effect: Effect.gen(function* () {
    const hooks = yield* HookService;
    const approvalWait = yield* ApprovalWaitService;
    const ruleEngine: RuleEngine = createRuleEngine(DEFAULT_DENY_RULES);
    const destructiveTools = new Set(DANGEROUS_TOOL_NAMES);
    const readonlyTools = new Set(READONLY_TOOL_NAMES);
    let _globalPermissionMode: PermissionMode = 'default';

    function makeForkedService(
      engine: RuleEngine,
      permMode: PermissionMode,
      roTools: Set<string>,
      destTools: Set<string>
    ): ApprovalService {
      let currentPermMode = permMode;
      return ApprovalService.make({
        evaluate: (request: {
          tool: string;
          input: Record<string, unknown>;
          context?: Record<string, unknown>;
          callId?: string;
          sessionId: string;
          projectPath?: string;
        }): Effect.Effect<ApprovalDecision> =>
          runPipeline(
            {
              tool: request.tool,
              input: request.input,
              context: request.context,
              callId: request.callId,
            },
            {
              ruleEngine: engine,
              readonlyTools: roTools,
              destructiveTools: destTools,
              permissionMode: currentPermMode,
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
        addRule: (rule: PermissionRule): Effect.Effect<void> =>
          Effect.sync(() => engine.addRule(rule)),
        removeRule: (id: string): Effect.Effect<void> => Effect.sync(() => engine.removeRule(id)),
        setPermissionMode: (mode: PermissionMode): Effect.Effect<void> =>
          Effect.sync(() => {
            currentPermMode = mode;
          }),
        getPermissionMode: (): PermissionMode => currentPermMode,
        fork: (opts?: {
          extraDenyRules?: PermissionRule[];
          readonly?: boolean;
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
              currentPermMode,
              new Set(roTools),
              new Set(destTools)
            );
          }),
      });
    }

    return {
      evaluate: (request: {
        tool: string;
        input: Record<string, unknown>;
        context?: Record<string, unknown>;
        callId?: string;
        sessionId: string;
        projectPath?: string;
      }): Effect.Effect<ApprovalDecision> =>
        runPipeline(
          {
            tool: request.tool,
            input: request.input,
            context: request.context,
            callId: request.callId,
          },
          {
            ruleEngine,
            readonlyTools,
            destructiveTools,
            permissionMode: _globalPermissionMode,
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

      addRule: (rule: PermissionRule): Effect.Effect<void> =>
        Effect.sync(() => ruleEngine.addRule(rule)),

      removeRule: (id: string): Effect.Effect<void> => Effect.sync(() => ruleEngine.removeRule(id)),

      setPermissionMode: (mode: PermissionMode): Effect.Effect<void> =>
        Effect.sync(() => {
          _globalPermissionMode = mode;
        }),

      getPermissionMode: (): PermissionMode => _globalPermissionMode,

      fork: (opts?: {
        extraDenyRules?: PermissionRule[];
        readonly?: boolean;
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
            _globalPermissionMode,
            new Set(readonlyTools),
            new Set(destructiveTools)
          );
        }),
    };
  }),
}) {}
