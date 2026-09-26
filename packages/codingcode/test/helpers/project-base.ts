import { mkdirSync } from 'fs';
import { beforeEach } from 'vitest';
import { getProjectBaseDir } from '../../src/core/path.js';
import { useTempHome } from './temp-home.js';

export interface TempProjectBase {
  readonly dir: string;
}

/**
 * 把 `getProjectBaseDir()`（`~/.codingcode/project`）关进临时目录。
 *
 * 它本身没有独立开关（应用不提供「可指定」入口），只能靠把进程 home 指到沙箱，
 * 因此本助手 = `useTempHome` + 建出 project 目录。
 */
export function useTempProjectBase(prefix = 'codingcode-test-project-base-'): TempProjectBase {
  useTempHome(prefix);
  beforeEach(() => {
    mkdirSync(getProjectBaseDir(), { recursive: true });
  });
  return {
    get dir() {
      return getProjectBaseDir();
    },
  };
}
