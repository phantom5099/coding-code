import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import { normalizePath, encodeProjectPath, getGlobalDir } from '../../src/util/path.js';
import { ShadowGit } from '../../src/checkpoint/shadow-git.js';
import { setFakeHome, restoreHome } from '../helpers/temp-home.js';

describe('util/path：纯格式化函数', () => {
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

describe('util/path：全局目录', () => {
  it('全局目录落在用户目录下', () => {
    expect(getGlobalDir()).toBe(join(homedir(), '.codingcode'));
  });

  it('每次调用时求值：把 home 指到临时目录立刻生效（测试隔离依赖这一点）', () => {
    const fake = join(tmpdir(), `codingcode-dirs-${Date.now()}`);
    const prev = setFakeHome(fake);
    try {
      expect(getGlobalDir()).toBe(join(fake, '.codingcode'));
    } finally {
      restoreHome(prev);
    }
  });
});
