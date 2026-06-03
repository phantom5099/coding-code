import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { runPipeline } from '../../src/approval/pipeline.js';
import { createRuleEngine } from '../../src/approval/rule-engine.js';
import type { PermissionRule, ApprovalDecision } from '../../src/approval/types.js';
import { READONLY_TOOL_NAMES } from '../../src/approval/presets.js';

const readonlyTools = new Set(READONLY_TOOL_NAMES);

const mockHooks = {
  emitPreToolUseDecision: () => Effect.succeed(null),
  recordAudit: () => Effect.void,
};

describe('Approval Pipeline', () => {
  it('Layer 1: Rule Engine deny should short-circuit', async () => {
    const rules: PermissionRule[] = [
      { id: 'deny', action: 'deny', toolPattern: '*', argPattern: 'rm -rf *', reason: 'Blocked' },
    ];
    const decision = await Effect.runPromise(
      runPipeline(
        { tool: 'Bash', input: { command: 'rm -rf /var' } },
        {
          ruleEngine: createRuleEngine(rules),
          readonlyTools: readonlyTools,
          destructiveTools: new Set(),
          permissionMode: 'default',
          hooks: mockHooks,
          interactive: false,
          sessionId: 'test',
        }
      )
    );
    expect(decision.type).toBe('deny');
    expect(decision.source).toContain('rule:');
  });

  it('Layer 2: Read-only whitelist should auto-allow', async () => {
    const decision = await Effect.runPromise(
      runPipeline(
        { tool: 'read_file', input: { path: '/safe/file.txt' } },
        {
          ruleEngine: createRuleEngine(),
          readonlyTools: readonlyTools,
          destructiveTools: new Set(),
          permissionMode: 'default',
          hooks: mockHooks,
          interactive: false,
          sessionId: 'test',
        }
      )
    );
    expect(decision.type).toBe('allow');
    expect(decision.source).toBe('readonly-whitelist');
  });

  it('Layer 3: Plan mode should deny write tools', async () => {
    const decision = await Effect.runPromise(
      runPipeline(
        { tool: 'write_file', input: { path: '/test.txt', content: 'data' } },
        {
          ruleEngine: createRuleEngine(),
          readonlyTools: readonlyTools,
          destructiveTools: new Set(['Bash']),
          permissionMode: 'plan',
          hooks: mockHooks,
          interactive: false,
          sessionId: 'test',
        }
      )
    );
    expect(decision.type).toBe('deny');
    expect(decision.reason).toContain('plan mode');
  });

  it('Layer 3: Plan mode should allow read-only tools', async () => {
    const decision = await Effect.runPromise(
      runPipeline(
        { tool: 'read_file', input: { path: '/test.txt' } },
        {
          ruleEngine: createRuleEngine(),
          readonlyTools: readonlyTools,
          destructiveTools: new Set(),
          permissionMode: 'plan',
          hooks: mockHooks,
          interactive: false,
          sessionId: 'test',
        }
      )
    );
    expect(decision.type).toBe('allow');
  });

  it('Layer 3: Bypass mode should allow everything', async () => {
    const decision = await Effect.runPromise(
      runPipeline(
        { tool: 'Bash', input: { command: 'rm -rf /' } },
        {
          ruleEngine: createRuleEngine(),
          readonlyTools: readonlyTools,
          destructiveTools: new Set(['Bash']),
          permissionMode: 'bypass',
          hooks: mockHooks,
          interactive: false,
          sessionId: 'test',
        }
      )
    );
    expect(decision.type).toBe('allow');
    expect(decision.source).toBe('permission-mode');
  });

  it('Layer 3: AcceptEdits mode should auto-allow non-destructive tools', async () => {
    const decision = await Effect.runPromise(
      runPipeline(
        { tool: 'write_file', input: { path: '/test.txt' } },
        {
          ruleEngine: createRuleEngine(),
          readonlyTools: readonlyTools,
          destructiveTools: new Set(['Bash', 'execute_command']),
          permissionMode: 'acceptEdits',
          hooks: mockHooks,
          interactive: false,
          sessionId: 'test',
        }
      )
    );
    expect(decision.type).toBe('allow');
  });

  it('Layer 3: AcceptEdits should NOT auto-allow destructive tools', async () => {
    const decision = await Effect.runPromise(
      runPipeline(
        { tool: 'Bash', input: { command: 'rm file' } },
        {
          ruleEngine: createRuleEngine(),
          readonlyTools: readonlyTools,
          destructiveTools: new Set(['Bash', 'execute_command']),
          permissionMode: 'acceptEdits',
          hooks: mockHooks,
          interactive: false,
          sessionId: 'test',
        }
      )
    );
    // Should continue to user confirmation layer (which returns deny in non-interactive mode)
    expect(decision.type).toBe('deny');
    expect(decision.source).toBe('user-confirm');
  });

  it('Layer 4: PreToolUse hook can deny (non-readonly tool)', async () => {
    const hooksWithDeny = {
      ...mockHooks,
      emitPreToolUseDecision: () =>
        Effect.succeed({ decision: 'deny' as const, reason: 'Hook denied' }),
    };
    const decision = await Effect.runPromise(
      runPipeline(
        { tool: 'Bash', input: { command: 'ls' } },
        {
          ruleEngine: createRuleEngine(),
          readonlyTools: readonlyTools,
          destructiveTools: new Set(['Bash']),
          permissionMode: 'default',
          hooks: hooksWithDeny,
          interactive: false,
          sessionId: 'test',
        }
      )
    );
    expect(decision.type).toBe('deny');
    expect(decision.source).toBe('hook');
  });

  it('Layer 4: PreToolUse hook can allow (skiping user confirmation)', async () => {
    const hooksWithAllow = {
      ...mockHooks,
      emitPreToolUseDecision: () => Effect.succeed({ decision: 'allow' as const }),
    };
    const decision = await Effect.runPromise(
      runPipeline(
        { tool: 'Bash', input: { command: 'ls' } },
        {
          ruleEngine: createRuleEngine(),
          readonlyTools: readonlyTools,
          destructiveTools: new Set(['Bash']),
          permissionMode: 'default',
          hooks: hooksWithAllow,
          interactive: false,
          sessionId: 'test',
        }
      )
    );
    expect(decision.type).toBe('allow');
    expect(decision.source).toBe('hook');
  });

  it('Layer 6: Audit log is recorded for every decision', async () => {
    let auditEntry: any = null;
    const hooksWithAudit = {
      ...mockHooks,
      recordAudit: (entry: any) =>
        Effect.sync(() => {
          auditEntry = entry;
        }),
    };
    await Effect.runPromise(
      runPipeline(
        { tool: 'read_file', input: { path: '/test.txt' } },
        {
          ruleEngine: createRuleEngine(),
          readonlyTools: readonlyTools,
          destructiveTools: new Set(),
          permissionMode: 'default',
          hooks: hooksWithAudit,
          interactive: false,
          sessionId: 'test',
        }
      )
    );
    expect(auditEntry).not.toBeNull();
    expect(auditEntry.tool).toBe('read_file');
    expect(auditEntry.layers).toContain('AuditLog');
    expect(auditEntry.decision.type).toBe('allow');
  });
});
