import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { ShadowGit } from '../../src/checkpoint/shadow-git.js';

function tmpProject(): string {
  const dir = join(tmpdir(), `shadow-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('ShadowGit', () => {
  let projectPath: string;
  let sg: ShadowGit;

  beforeEach(() => {
    projectPath = tmpProject();
    sg = new ShadowGit(projectPath);
    sg.init();
  });

  afterEach(() => {
    try { rmSync(projectPath, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('initializes a bare repository', () => {
    expect(existsSync(sg.gitDir)).toBe(true);
    expect(existsSync(join(sg.gitDir, 'HEAD'))).toBe(true);
  });

  it('commits and returns a hash', () => {
    const hash = sg.commit('test-commit');
    expect(hash).toBeTruthy();
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThanOrEqual(6);
  });

  it('diff detects file changes', () => {
    // Create a file and commit as baseline
    writeFileSync(join(projectPath, 'a.txt'), 'hello', 'utf8');
    const baseline = sg.commit('baseline');

    // Modify the file
    writeFileSync(join(projectPath, 'a.txt'), 'world', 'utf8');
    const final = sg.commit('final');

    const diff = sg.diffFiles(baseline, final);
    expect(diff.length).toBe(1);
    expect(diff[0].status).toBe('M');
    expect(diff[0].file).toBe('a.txt');
  });

  it('diff detects new files', () => {
    const baseline = sg.commit('baseline');
    writeFileSync(join(projectPath, 'new.txt'), 'new file', 'utf8');
    const final = sg.commit('final');

    const diff = sg.diffFiles(baseline, final);
    expect(diff.some((d) => d.status === 'A' && d.file === 'new.txt')).toBe(true);
  });

  it('checkout restores files', () => {
    writeFileSync(join(projectPath, 'r.txt'), 'original', 'utf8');
    const baseline = sg.commit('baseline');
    writeFileSync(join(projectPath, 'r.txt'), 'modified', 'utf8');
    sg.commit('final');

    sg.checkoutFiles(baseline, ['r.txt']);
    expect(readFileSync(join(projectPath, 'r.txt'), 'utf8')).toBe('original');
  });

  it('excludes node_modules from tracking', () => {
    mkdirSync(join(projectPath, 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(join(projectPath, 'src'), { recursive: true });
    writeFileSync(join(projectPath, 'node_modules', 'pkg', 'index.js'), 'module', 'utf8');
    writeFileSync(join(projectPath, 'src', 'index.ts'), 'console.log', 'utf8');

    const baseline = sg.commit('baseline');
    // node_modules should not be in diff if we add more
    writeFileSync(join(projectPath, 'src', 'index.ts'), 'console.log("updated")', 'utf8');
    const final = sg.commit('final');

    const diff = sg.diffFiles(baseline, final);
    expect(diff.some((d) => d.file.startsWith('node_modules'))).toBe(false);
  });

  it('findCommitByMessage finds commits by message pattern', () => {
    sg.commit('turn-abc-1-baseline');
    sg.commit('turn-abc-2-baseline');

    const found = sg.findCommitByMessage('turn-abc-1-baseline');
    expect(found).toBeTruthy();
    expect(typeof found).toBe('string');
  });

  it('shouldFallback returns false for small projects', () => {
    writeFileSync(join(projectPath, 'small.txt'), 'x'.repeat(100), 'utf8');
    expect(sg.shouldFallback()).toBe(false);
  });
});
