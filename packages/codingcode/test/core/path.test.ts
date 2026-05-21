import { describe, it, expect } from 'vitest';
import { normalizePath, projectSlugFromPath } from '../../src/core/path.js';
import { ShadowGit } from '../../src/checkpoint/shadow-git.js';

describe('core/path', () => {
  it('normalizePath unifies Windows path variants', () => {
    expect(normalizePath('C:\\Users\\proj')).toBe('c:/Users/proj');
    expect(normalizePath('/c/Users/proj')).toBe('c:/Users/proj');
    expect(normalizePath('c:/Users/proj')).toBe('c:/Users/proj');
  });

  it('projectSlugFromPath returns same slug for equivalent paths', () => {
    const a = projectSlugFromPath('C:\\Users\\proj');
    const b = projectSlugFromPath('/c/Users/proj');
    const c = projectSlugFromPath('c:/Users/proj');
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a).toHaveLength(16);
  });

  it('ShadowGit uses same slug as projectSlugFromPath', () => {
    const path = '/tmp/my-project';
    const sg = new ShadowGit(path);
    expect(sg.gitDir).toContain(projectSlugFromPath(path));
  });
});
