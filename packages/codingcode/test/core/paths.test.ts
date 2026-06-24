import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { computePaths, projectSessionsDir, sessionJsonlPathFromCwd } from '../../src/core/path.js';

describe('core/path.ts contains path computation functions', () => {
  it('does not import from session/types — no core→session dependency', () => {
    const src = readFileSync(
      'C:/Users/10116/Desktop/agent/coding code/packages/codingcode/src/core/path.ts',
      'utf8'
    );
    expect(src).not.toMatch(/from\s+['"]\.\.\/session\//);
  });

  it('exports computePaths, projectSessionsDir, sessionJsonlPathFromCwd', () => {
    expect(typeof computePaths).toBe('function');
    expect(typeof projectSessionsDir).toBe('function');
    expect(typeof sessionJsonlPathFromCwd).toBe('function');
  });
});

describe('session/file-ops.ts re-exports paths from core', () => {
  it('file-ops.ts no longer defines computePaths inline', () => {
    const src = readFileSync(
      'C:/Users/10116/Desktop/agent/coding code/packages/codingcode/src/session/file-ops.ts',
      'utf8'
    );
    expect(src).not.toMatch(/export function computePaths\s*\(/);
    expect(src).not.toMatch(/export function projectSessionsDir\s*\(/);
    expect(src).toMatch(/from\s+['"]\.\.\/core\/path\.js['"]/);
  });
});
