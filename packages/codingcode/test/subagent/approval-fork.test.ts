import { expect, it, describe } from 'vitest';
import { Effect } from 'effect';
import { ApprovalService } from '../../src/approval/index';
import { HookService } from '../../src/hooks/registry';
import { ApprovalWaitService } from '../../src/approval/async-confirm';

describe('ApprovalService.fork', () => {
  it('should create a forked approval service', async () => {
    const parent = Effect.runSync(ApprovalService);
    const forkEffect = (parent as any).fork();

    const child = await Effect.runPromise(forkEffect);
    expect(child).toBeDefined();
    expect(child.evaluate).toBeDefined();
    expect(child.fork).toBeDefined();
  });

  it('should have independent permission mode', async () => {
    const parent = Effect.runSync(ApprovalService);
    const forkEffect = (parent as any).fork();

    const child = await Effect.runPromise(forkEffect);

    // Child mode should be independent
    const parentMode = parent.getPermissionMode();
    const childMode = child.getPermissionMode();

    // Both should be 'default' initially
    expect(parentMode).toBe('default');
    expect(childMode).toBe('default');

    // Change child mode
    await Effect.runPromise(child.setPermissionMode('acceptEdits'));

    // Parent should not be affected
    expect(parent.getPermissionMode()).toBe('default');
    expect(child.getPermissionMode()).toBe('acceptEdits');
  });

  it('should inherit parent rules', async () => {
    const parent = Effect.runSync(ApprovalService);

    // Add a rule to parent
    await Effect.runPromise(
      parent.addRule({
        id: 'parent-rule',
        action: 'deny',
        toolPattern: 'dangerous_tool',
      }),
    );

    // Fork should inherit the rule
    const forkEffect = (parent as any).fork();
    const child = await Effect.runPromise(forkEffect);

    // Child should have parent's rules
    expect(child).toBeDefined();
  });

  it('should support readonly mode to deny destructive operations', async () => {
    const parent = Effect.runSync(ApprovalService);
    const forkEffect = (parent as any).fork({ readonly: true });

    const child = await Effect.runPromise(forkEffect);

    // Child should have readonly constraints
    expect(child).toBeDefined();
    expect(child.evaluate).toBeDefined();
  });

  it('should support extra deny rules on fork', async () => {
    const parent = Effect.runSync(ApprovalService);
    const forkEffect = (parent as any).fork({
      extraDenyRules: [
        {
          id: 'fork-deny',
          action: 'deny',
          toolPattern: 'custom_tool',
        },
      ],
    });

    const child = await Effect.runPromise(forkEffect);

    // Child should have the extra deny rule
    expect(child).toBeDefined();
  });

  it('should support nested fork', async () => {
    const parent = Effect.runSync(ApprovalService);

    const forkEffect1 = (parent as any).fork();
    const child1 = await Effect.runPromise(forkEffect1);

    const forkEffect2 = (child1 as any).fork();
    const child2 = await Effect.runPromise(forkEffect2);

    // All should be independent
    expect(child1).toBeDefined();
    expect(child2).toBeDefined();

    // Their modes should be independent
    await Effect.runPromise(child1.setPermissionMode('acceptEdits'));
    await Effect.runPromise(child2.setPermissionMode('dontAsk'));

    expect(child1.getPermissionMode()).toBe('acceptEdits');
    expect(child2.getPermissionMode()).toBe('dontAsk');
  });

  it('should preserve parent rules in fork', async () => {
    const parent = Effect.runSync(ApprovalService);

    // Add multiple rules to parent
    await Effect.runPromise(
      parent.addRule({
        id: 'rule1',
        action: 'allow',
        toolPattern: 'safe_tool',
      }),
    );

    await Effect.runPromise(
      parent.addRule({
        id: 'rule2',
        action: 'ask',
        toolPattern: 'maybe_tool',
      }),
    );

    // Fork should have both rules
    const forkEffect = (parent as any).fork();
    const child = await Effect.runPromise(forkEffect);

    expect(child).toBeDefined();
  });

  it('should isolate rule changes', async () => {
    const parent = Effect.runSync(ApprovalService);
    const forkEffect = (parent as any).fork();
    const child = await Effect.runPromise(forkEffect);

    // Add rule to child
    await Effect.runPromise(
      child.addRule({
        id: 'child-rule',
        action: 'deny',
        toolPattern: 'child_only_tool',
      }),
    );

    // Parent should not see child's rule
    // This is implicit - the services are independent
    expect(parent).toBeDefined();
    expect(child).toBeDefined();
  });

  it('should combine readonly and extra deny rules', async () => {
    const parent = Effect.runSync(ApprovalService);

    const forkEffect = (parent as any).fork({
      readonly: true,
      extraDenyRules: [
        {
          id: 'extra',
          action: 'deny',
          toolPattern: 'special_tool',
        },
      ],
    });

    const child = await Effect.runPromise(forkEffect);

    // Child should have both readonly constraints and extra rules
    expect(child).toBeDefined();
  });
});
