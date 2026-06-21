import type { PermissionRule, RuleAction, ApprovalDecision } from './types.js';

/**
 * Convert a simple glob pattern to a RegExp.
 * Supports: *, **, ?, and character classes [...]
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '___DOUBLESTAR___')
    .replace(/\*/g, '.*')
    .replace(/___DOUBLESTAR___/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function matchPattern(pattern: string, value: string): boolean {
  return globToRegex(pattern).test(value);
}

function getSerializedArgs(input: Record<string, unknown>): string {
  return Object.values(input)
    .filter((v): v is string => typeof v === 'string')
    .join(' ');
}

export interface RuleEngine {
  addRule(rule: PermissionRule): void;
  removeRule(id: string): void;
  evaluate(tool: string, input: Record<string, unknown>): ApprovalDecision | null;
  getAllRules(): PermissionRule[];
}

export function createRuleEngine(initialRules: PermissionRule[] = []): RuleEngine {
  const rules = new Map<string, PermissionRule>();

  for (const rule of initialRules) {
    rules.set(rule.id, rule);
  }

  function evaluate(tool: string, input: Record<string, unknown>): ApprovalDecision | null {
    const serializedArgs = getSerializedArgs(input);
    const sorted = Array.from(rules.values()).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    for (const rule of sorted) {
      if (!matchPattern(rule.toolPattern, tool)) continue;

      if (rule.argRegex) {
        if (!rule.argRegex.test(serializedArgs)) continue;
      } else if (rule.argPattern) {
        if (!matchPattern(rule.argPattern, serializedArgs)) continue;
      }

      const action = rule.action as RuleAction;
      switch (action) {
        case 'deny':
          return {
            type: 'deny',
            reason: rule.reason ?? `Denied by rule: ${rule.id}`,
            source: `rule:${rule.id}`,
          };
        case 'allow':
          return { type: 'allow', source: `rule:${rule.id}` };
        case 'ask':
          continue;
      }
    }

    return null;
  }

  return {
    addRule: (rule: PermissionRule) => {
      rules.set(rule.id, rule);
    },
    removeRule: (id: string) => {
      rules.delete(id);
    },
    evaluate,
    getAllRules: () => Array.from(rules.values()),
  };
}
