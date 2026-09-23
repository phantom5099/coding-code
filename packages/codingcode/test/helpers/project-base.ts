import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach } from 'vitest';
import { setProjectBaseDir, getProjectBaseDir } from '../../src/core/path.js';

export interface TempProjectBase {
  readonly dir: string;
}

export function useTempProjectBase(prefix = 'codingcode-test-project-base-'): TempProjectBase {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), prefix));
    setProjectBaseDir(dir);
  });
  afterEach(() => {
    setProjectBaseDir(undefined);
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    get dir() {
      return getProjectBaseDir();
    },
  };
}
