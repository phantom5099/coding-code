import { describe, it, expect } from 'vitest';
import { join, resolve } from 'path';
import { homedir, tmpdir } from 'os';
import {
  normalizePath,
  encodeProjectPath,
  resolveCwd,
  getTempCwd,
  isGlobalCwd,
  CODINGCODE_DIRNAME,
  getGlobalDir,
  getProjectDir,
} from '../../src/core/path.js';
import { ShadowGit } from '../../src/checkpoint/shadow-git.js';
import { setFakeHome, restoreHome } from '../helpers/temp-home.js';

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

  it('resolveCwd uses the request cwd when present', () => {
    const otherDir = join(tmpdir(), 'cc-other');
    expect(resolveCwd(otherDir)).toBe(resolve(otherDir));
  });

  it('resolveCwd falls back to the shared temp workspace', () => {
    expect(resolveCwd()).toBe(getTempCwd());
    expect(resolveCwd('')).toBe(getTempCwd());
    expect(getTempCwd()).not.toBe(process.cwd());
  });

  it('isGlobalCwd treats missing, empty and "global" as global', () => {
    expect(isGlobalCwd(undefined)).toBe(true);
    expect(isGlobalCwd('')).toBe(true);
    expect(isGlobalCwd('global')).toBe(true);
    expect(isGlobalCwd('/some/project')).toBe(false);
  });
});

describe('core/path：全局与工作区共用的私有目录名', () => {
  it('目录名字面量被钉住：改它必须显式改这里', () => {
    expect(CODINGCODE_DIRNAME).toBe('.codingcode');
  });

  it('全局目录落在用户目录下', () => {
    expect(getGlobalDir()).toBe(join(homedir(), '.codingcode'));
  });

  it('工作区目录落在 projectRoot 下', () => {
    expect(getProjectDir('/some/project')).toBe(join('/some/project', '.codingcode'));
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
