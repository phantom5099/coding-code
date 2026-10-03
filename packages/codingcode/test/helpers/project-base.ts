import { mkdirSync } from 'fs';
import { join } from 'path';
import { beforeEach } from 'vitest';
import { getGlobalDir } from '../../src/core/path.js';
import { PROJECTS_DIRNAME } from '../../src/contracts/paths.js';
import { useTempHome } from './temp-home.js';

export interface TempProjectBase {
  readonly dir: string;
}

/** 工作区数据的公共根：`~/.codingcode/project`。 */
export function projectBaseDir(): string {
  return join(getGlobalDir(), PROJECTS_DIRNAME);
}


export function useTempProjectBase(prefix = 'codingcode-test-project-base-'): TempProjectBase {
  useTempHome(prefix);
  beforeEach(() => {
    mkdirSync(projectBaseDir(), { recursive: true });
  });
  return {
    get dir() {
      return projectBaseDir();
    },
  };
}
