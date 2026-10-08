import { mkdirSync } from 'fs';
import { beforeEach } from 'vitest';
import { projectRootDir } from '../../src/util/path.js';
import { useTempHome } from './temp-home.js';

export interface TempProjectBase {
  readonly dir: string;
}

/** 工作区数据的公共根：`~/.codingcode/project`。 */
export function projectBaseDir(): string {
  return projectRootDir();
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
