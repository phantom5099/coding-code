import { describe, it, expect } from 'vitest';
import { normalizePath, encodeProjectPath } from '../../src/core/path.js';
import { ShadowGit } from '../../src/checkpoint/shadow-git.js';

describe('core/path', () => {
  it('normalizePath unifies Windows path variants', () => {
    expect(normalizePath('C:\\Users\\proj')).toBe('c:/Users/proj');
    expect(normalizePath('/c/Users/proj')).toBe('c:/Users/proj');
    expect(normalizePath('c:/Users/proj')).toBe('c:/Users/proj');
  });

  it('encodeProjectPath returns same encoded path for equivalent paths', () => {
    const a = encodeProjectPath('C:\\Users\\proj');
    const b = encodeProjectPath('/c/Users/proj');
    const c = encodeProjectPath('c:/Users/proj');
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a).toBe('c-users-proj');
  });

  it('encodeProjectPath handles spaces', () => {
    expect(encodeProjectPath('c:/my project/foo bar')).toBe('c-my-project-foo-bar');
  });

  it('encodeProjectPath handles Unix paths', () => {
    expect(encodeProjectPath('/home/user/my-project')).toBe('home-user-my-project');
  });

  it('ShadowGit gitDir uses encoded project path', () => {
    const path = '/tmp/my-project';
    const sg = new ShadowGit(path);
    expect(sg.gitDir).toContain(encodeProjectPath(path));
  });
});
