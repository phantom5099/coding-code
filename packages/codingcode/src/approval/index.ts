import { Effect } from 'effect';
import { HookService } from '../hooks/registry';
import type { PermissionMode, PermissionRule, ApprovalDecision } from './types';
import { createRuleEngine, type RuleEngine } from './rule-engine';
import { DEFAULT_DENY_RULES, READONLY_TOOL_NAMES, DESTRUCTIVE_TOOL_NAMES } from './presets';
import { runPipeline, type PipelineHooks } from './pipeline';
import { ApprovalWaitService, hasEmitter } from './async-confirm';

// Module-level singleton so all callers (HTTP routes, direct client, service) share the same state.
let _globalPermissionMode: PermissionMode = 'default';

export function getGlobalPermissionMode(): PermissionMode {
  return _globalPermissionMode;
}

export function setGlobalPermissionMode(mode: PermissionMode): void {
  _globalPermissionMode = mode;
}

export class ApprovalService extends Effect.Service<ApprovalService>()('Approval', {
  effect: Effect.gen(function* () {
    const hooks = yield* HookService;
    const approvalWait = yield* ApprovalWaitService;
    const ruleEngine: RuleEngine = createRuleEngine(DEFAULT_DENY_RULES);
    const readonlyTools = new Set(READONLY_TOOL_NAMES);
    const destructiveTools = new Set(DESTRUCTIVE_TOOL_NAMES);

    function buildPipelineHooks(): PipelineHooks {
      return {
        emitPreToolUseDecision: (payload) =>
          Effect.gen(function* () {
            const result = yield* hooks.emitDecision('tool.approval.pre', payload);
            // Filter out 'continue' decision if present (used only by agent loop)
            if (result && result.decision === 'continue') {
              return null;
            }
            return result as any;
          }),

        recordAudit: (entry) =>
          hooks.emit('tool.approval.post', entry as unknown as Record<string, unknown>),
      };
    }

    return {
      evaluate: (request: {
        tool: string;
        input: Record<string, unknown>;
        context?: Record<string, unknown>;
        callId?: string;
        sessionId: string;
      }): Effect.Effect<ApprovalDecision> =>
        Effect.gen(function* () {
          return yield* runPipeline(
            { tool: request.tool, input: request.input, context: request.context, callId: request.callId },
            {
              ruleEngine,
              readonlyTools,
              destructiveTools,
              permissionMode: _globalPermissionMode,
              hooks: buildPipelineHooks(),
              interactive: process.stdin.isTTY ?? false,
              asyncConfirm: hasEmitter(request.sessionId),
              asyncConfirmService: approvalWait,
              onAlways: (rule) => ruleEngine.addRule(rule),
              onNever: (rule) => ruleEngine.addRule(rule),
              sessionId: request.sessionId,
              callId: request.callId,
            },
          );
        }),

      addRule: (rule: PermissionRule): Effect.Effect<void> =>
        Effect.sync(() => ruleEngine.addRule(rule)),

      removeRule: (id: string): Effect.Effect<void> =>
        Effect.sync(() => ruleEngine.removeRule(id)),

      setPermissionMode: (mode: PermissionMode): Effect.Effect<void> =>
        Effect.sync(() => { setGlobalPermissionMode(mode); }),

      getPermissionMode: (): PermissionMode => getGlobalPermissionMode(),

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
            const denyRules: PermissionRule[] = DESTRUCTIVE_TOOL_NAMES.map((toolName) => ({
              id: `readonly-${toolName}`,
              action: 'deny' as const,
              toolPattern: toolName,
              source: 'system' as const,
            }));
            for (const rule of denyRules) {
              childEngine.addRule(rule);
            }
          }
          let childPermissionMode: PermissionMode = _globalPermissionMode;
          const childReadonlyTools = new Set(readonlyTools);
          const childDestructiveTools = new Set(destructiveTools);
          return {
            evaluate: (request: { tool: string; input: Record<string, unknown>; context?: Record<string, unknown>; callId?: string; sessionId: string }) =>
              Effect.gen(function* () {
                return yield* runPipeline(
                  { tool: request.tool, input: request.input, context: request.context, callId: request.callId },
                  {
                    ruleEngine: childEngine,
                    readonlyTools: childReadonlyTools,
                    destructiveTools: childDestructiveTools,
                    permissionMode: childPermissionMode,
                    hooks: buildPipelineHooks(),
                    interactive: process.stdin.isTTY ?? false,
                    asyncConfirm: hasEmitter(request.sessionId),
                    asyncConfirmService: approvalWait,
                    onAlways: (rule) => childEngine.addRule(rule),
                    onNever: (rule) => childEngine.addRule(rule),
                    sessionId: request.sessionId,
                    callId: request.callId,
                  },
                );
              }),
            addRule: (rule: PermissionRule) => Effect.sync(() => childEngine.addRule(rule)),
            removeRule: (id: string) => Effect.sync(() => childEngine.removeRule(id)),
            setPermissionMode: (mode: PermissionMode) => Effect.sync(() => { childPermissionMode = mode; }),
            getPermissionMode: () => childPermissionMode,
            fork: (opts2: any) => {
              const nestedParentRules = childEngine.getAllRules();
              const nestedEngine = createRuleEngine(nestedParentRules);
              if (opts2?.extraDenyRules) {
                for (const rule of opts2.extraDenyRules) {
                  nestedEngine.addRule(rule);
                }
              }
              if (opts2?.readonly) {
                const denyRules: PermissionRule[] = DESTRUCTIVE_TOOL_NAMES.map((toolName) => ({
                  id: `readonly-${toolName}`,
                  action: 'deny' as const,
                  toolPattern: toolName,
                  source: 'system' as const,
                }));
                for (const rule of denyRules) {
                  nestedEngine.addRule(rule);
                }
              }
              let nestedPermissionMode: PermissionMode = childPermissionMode;
              const nestedReadonlyTools = new Set(childReadonlyTools);
              const nestedDestructiveTools = new Set(childDestructiveTools);
              return Effect.succeed({
                evaluate: (request: { tool: string; input: Record<string, unknown>; context?: Record<string, unknown>; callId?: string; sessionId: string }) =>
                  Effect.gen(function* () {
                    return yield* runPipeline(
                      { tool: request.tool, input: request.input, context: request.context, callId: request.callId },
                      {
                        ruleEngine: nestedEngine,
                        readonlyTools: nestedReadonlyTools,
                        destructiveTools: nestedDestructiveTools,
                        permissionMode: nestedPermissionMode,
                        hooks: buildPipelineHooks(),
                        interactive: process.stdin.isTTY ?? false,
                        asyncConfirm: hasEmitter(request.sessionId),
                        asyncConfirmService: approvalWait,
                        onAlways: (rule: PermissionRule) => nestedEngine.addRule(rule),
                        onNever: (rule: PermissionRule) => nestedEngine.addRule(rule),
                        sessionId: request.sessionId,
                        callId: request.callId,
                      },
                    );
                  }),
                addRule: (rule: PermissionRule) => Effect.sync(() => nestedEngine.addRule(rule)),
                removeRule: (id: string) => Effect.sync(() => nestedEngine.removeRule(id)),
                setPermissionMode: (mode: PermissionMode) => Effect.sync(() => { nestedPermissionMode = mode; }),
                getPermissionMode: () => nestedPermissionMode,
                fork: (opts3: any) => {
                  // Nested fork not commonly used, use parent's fork for now
                  return Effect.fail(new Error('Deeply nested fork not supported'));
                },
              } as any);
            },
          } as any;
        }),
    };
  }),
}) {}
