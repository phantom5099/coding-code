import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('scheduler uses real forked ApprovalService', () => {
  it('scheduler/service.ts no longer passes literal { permissionMode: "bypass" } as approvalOverride', () => {
    const src = readFileSync(new URL('../../src/scheduler/service.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/approvalOverride:\s*\{\s*permissionMode:\s*['"]bypass['"]\s*\}/);
  });

  it('scheduler imports ApprovalService', () => {
    const src = readFileSync(new URL('../../src/scheduler/service.ts', import.meta.url), 'utf8');
    expect(src).toMatch(
      /import\s*\{[^}]*ApprovalService[^}]*\}\s*from\s*['"]\.\.\/approval\/index\.js['"]/
    );
  });

  it('scheduler resolves ApprovalService and forks with bypass', () => {
    const src = readFileSync(new URL('../../src/scheduler/service.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/yield\*\s*ApprovalService/);
    expect(src).toMatch(/\.fork\(\s*\{\s*permissionMode:\s*['"]bypass['"]\s*\}\s*\)/);
  });
});
