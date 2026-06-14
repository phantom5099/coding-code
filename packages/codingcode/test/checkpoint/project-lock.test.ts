import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ProjectLock } from '../../src/checkpoint/project-lock.js';

describe('ProjectLock', () => {
  const dirs: string[] = [];

  function tempDir(): string {
    const dir = join(tmpdir(), `pl-test-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    dirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it('creates lock for a given project path', () => {
    const dir = tempDir();
    const lock = new ProjectLock(dir);
    expect(lock).toBeDefined();
  });

  it('acquires and releases lock', () => {
    const dir = tempDir();
    const lock = new ProjectLock(dir);
    lock.lock();
    lock.unlock();
  });

  it('prevents concurrent lock acquisition', () => {
    const dir = tempDir();
    const lock1 = new ProjectLock(dir);
    lock1.lock();
    try {
      const lock2 = new ProjectLock(dir);
      expect(() => lock2.lock()).toThrow('ProjectLock timeout');
    } finally {
      lock1.unlock();
    }
  });

  it('can reacquire lock after release', () => {
    const dir = tempDir();
    const lock = new ProjectLock(dir);
    lock.lock();
    lock.unlock();
    lock.lock();
    lock.unlock();
  });

  it('unlock is idempotent', () => {
    const dir = tempDir();
    const lock = new ProjectLock(dir);
    lock.unlock();
    lock.unlock();
    lock.lock();
    lock.unlock();
    lock.unlock();
  });

  it('same project path produces same lock file', () => {
    const dir = tempDir();
    const lock1 = new ProjectLock(dir);
    const lock2 = new ProjectLock(dir + '/'); // trailing slash
    lock1.lock();
    try {
      expect(() => lock2.lock()).toThrow('ProjectLock timeout');
    } finally {
      lock1.unlock();
    }
  });
});
