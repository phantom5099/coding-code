import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/** Read a source file and extract all JSX className strings from it */
function classNamesFromSource(relativePath: string): string[] {
  const src = readFileSync(resolve(__dirname, '..', 'src', relativePath), 'utf-8');
  const matches = src.matchAll(/className="([^"]*)"/g);
  return [...matches].map((m) => m[1]!);
}

/** Check if any className string in a source file contains a given substring */
function anyClassContains(file: string, substr: string): boolean {
  return classNamesFromSource(file).some((c) => c.includes(substr));
}

/** Get the specific className from a source file that matches a pattern */
function findClassContaining(file: string, substr: string): string | undefined {
  return classNamesFromSource(file).find((c) => c.includes(substr));
}

describe('text selection behavior', () => {
  describe('App.tsx', () => {
    it('root container should NOT have select-none', () => {
      // The root div's className should have h-screen but not select-none
      const rootClass = classNamesFromSource('App.tsx').find((c) => c.includes('h-screen'));
      expect(rootClass).toBeTruthy();
      expect(rootClass!).not.toContain('select-none');
    });
  });

  describe('TitleBar.tsx', () => {
    it('title bar should have select-none', () => {
      const barClass = classNamesFromSource('TitleBar.tsx').find(
        (c) => c.includes('shrink-0') && c.includes('flex items-center')
      );
      expect(barClass).toBeTruthy();
      expect(barClass!).toContain('select-none');
    });
  });

  describe('AgentSidebar.tsx', () => {
    it('expanded sidebar should have select-none', () => {
      const sidebarClass = classNamesFromSource('agent/AgentSidebar.tsx').find((c) =>
        c.includes('w-64')
      );
      expect(sidebarClass).toBeTruthy();
      expect(sidebarClass!).toContain('select-none');
    });
  });

  describe('ProjectStrip.tsx', () => {
    it('project strip should have select-none', () => {
      const stripClass = classNamesFromSource('agent/ProjectStrip.tsx').find(
        (c) => c.includes('w-12') && c.includes('shrink-0')
      );
      expect(stripClass).toBeTruthy();
      expect(stripClass!).toContain('select-none');
    });
  });

  describe('AgentWorkspace.tsx', () => {
    it('welcome h2 should NOT have select-none', () => {
      const h2Class = classNamesFromSource('agent/AgentWorkspace.tsx').find((c) =>
        c.includes('text-[22px]')
      );
      expect(h2Class).toBeTruthy();
      expect(h2Class!).not.toContain('select-none');
    });
  });
});
