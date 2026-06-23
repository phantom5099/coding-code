import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach } from 'vitest';
import {
  setProjectBaseDir,
  setProjectPlansBaseDir,
  getProjectBaseDir,
  getProjectPlansBaseDir,
} from '../../src/core/path.js';

export interface TempProjectBase {
  readonly dir: string;
  readonly plansDir: string;
}

export function useTempProjectBase(prefix = 'codingcode-test-project-base-'): TempProjectBase {
  let dir = '';
  let plansDir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), prefix));
    plansDir = join(dir, 'plans');
    mkdirSync(plansDir, { recursive: true });
    setProjectBaseDir(dir);
    setProjectPlansBaseDir(plansDir);
  });
  afterEach(() => {
    setProjectBaseDir(undefined);
    setProjectPlansBaseDir(undefined);
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    get dir() {
      return getProjectBaseDir();
    },
    get plansDir() {
      return getProjectPlansBaseDir();
    },
  };
}
