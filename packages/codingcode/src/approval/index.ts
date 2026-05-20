import { Effect } from 'effect';
import { HookService } from '../hooks/registry';
import type { PermissionMode, PermissionRule, ApprovalDecision } from './types';
import { createRuleEngine, type RuleEngine } from './rule-engine';
import { DEFAULT_DENY_RULES, READONLY_TOOL_NAMES, DESTRUCTIVE_TOOL_NAMES } from './presets';
import { runPipeline, type PipelineHooks } from './pipeline';
import { approvalEmitter, ApprovalWaitService } from './async-confirm';

export class ApprovalService extends Effect.Service<ApprovalService>()('Approval', {
  effect: Effect.gen(function* () {
    const hooks = yield* HookService;
    const approvalWait = yield* ApprovalWaitService;
    const ruleEngine: RuleEngine = createRuleEngine(DEFAULT_DENY_RULES);
    const readonlyTools = new Set(READONLY_TOOL_NAMES);
    const destructiveTools = new Set(DESTRUCTIVE_TOOL_NAMES);
    let permissionMode: PermissionMode = 'default';

    function buildPipelineHooks(): PipelineHooks {
      return {
        emitPreToolUseDecision: (payload) =>
          hooks.emitDecision('tool.approval.pre', payload),

        recordAudit: (entry) =>
          hooks.emit('tool.approval.post', entry as unknown as Record<string, unknown>),
      };
    }

    return {
      evaluate: (request: {
        tool: string;
        input: Record<string, unknown>;
        context?: Record<string, unknown>;
      }): Effect.Effect<ApprovalDecision> =>
        Effect.gen(function* () {
          // Check if an approval emitter is set (we're inside an SSE handler)
          const hasAsyncEmitter = approvalEmitter.current !== null;
          return yield* runPipeline(
            { tool: request.tool, input: request.input, context: request.context },
            {
              ruleEngine,
              readonlyTools,
              destructiveTools,
              permissionMode,
              hooks: buildPipelineHooks(),
              interactive: process.stdin.isTTY ?? false,
              asyncConfirm: hasAsyncEmitter,
              asyncConfirmService: approvalWait,
              onAlways: (rule) => ruleEngine.addRule(rule),
              onNever: (rule) => ruleEngine.addRule(rule),
            },
          );
        }),

      addRule: (rule: PermissionRule): Effect.Effect<void> =>
        Effect.sync(() => ruleEngine.addRule(rule)),

      removeRule: (id: string): Effect.Effect<void> =>
        Effect.sync(() => ruleEngine.removeRule(id)),

      setPermissionMode: (mode: PermissionMode): Effect.Effect<void> =>
        Effect.sync(() => { permissionMode = mode; }),

      getPermissionMode: (): PermissionMode => permissionMode,
    };
  }),
}) {}
