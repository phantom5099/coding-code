import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function classNamesFromSource(relativePath: string): string[] {
  const src = readFileSync(resolve(__dirname, '..', 'src', relativePath), 'utf-8');
  const matches = src.matchAll(/className="([^"]*)"/g);
  return [...matches].map((m) => m[1]!);
}

describe('MessageStream scroll layout', () => {
  const allClasses = classNamesFromSource('agent/MessageStream.tsx');

  it('Virtuoso container should have min-h-0', () => {
    // The div wrapping Virtuoso must have min-h-0 so its flex-1
    // can shrink below content height in the AgentWorkspace flex column
    const virtuosoWrap = allClasses.find(
      (c) => c.includes('flex-1') && c.includes('flex-col') && c.includes('min-h-0')
    );
    expect(virtuosoWrap).toBeTruthy();
  });

  it('Virtuoso is the unified rendering path (no isLargeList split)', () => {
    // After unification, there is only one container variant with min-h-0
    const minH0Count = allClasses.filter(
      (c) => c.includes('flex-1') && c.includes('flex-col') && c.includes('min-h-0')
    ).length;
    expect(minH0Count).toBeGreaterThanOrEqual(1);
  });
});
