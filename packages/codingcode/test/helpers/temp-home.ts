import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach } from 'vitest';

/** home 相关环境变量的快照，供 `restoreHome` 还原 */
export interface HomeSnapshot {
  readonly HOME: string | undefined;
  readonly USERPROFILE: string | undefined;
}

export interface TempHome {
  /** 临时 home 目录本身 */
  readonly home: string;
  /**
   * 全局配置目录 = `join(home, '.codingcode')`；未必已存在，写配置的代码会自行创建。
   *
   * 这里刻意写字面量而不引用源码常量：本助手模拟的是「OS 提供的 home 布局」，
   * 常量若被改错，正需要在这一侧显性同步才能暴露出来（另有 `test/util/path.test.ts` 钉住字面量）。
   */
  readonly configDir: string;
}

/** 立即把 home 指向 `dir`（不创建目录）；返回旧值，交给 `restoreHome` 还原 */
export function setFakeHome(dir: string): HomeSnapshot {
  const prev: HomeSnapshot = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  return prev;
}

/** 还原 `setFakeHome` 捕获的环境变量 */
export function restoreHome(prev: HomeSnapshot): void {
  if (prev.HOME === undefined) delete process.env.HOME;
  else process.env.HOME = prev.HOME;
  if (prev.USERPROFILE === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = prev.USERPROFILE;
}

/**
 * 把进程 home 指向临时目录，使 `~/.codingcode` 落到沙箱里，不碰开发机真实用户目录。
 *
 * 两个变量都要设：`os.homedir()` 在 Windows 只认 `USERPROFILE`、在 POSIX 只认 `HOME`
 * （实测 Windows 下仅设 `HOME` 无效）。⇒ 被测代码必须**每次调用时**才解析 home，
 * 不能在模块加载期把路径算成常量，否则这里改的变量起不到作用。
 */
export function useTempHome(prefix = 'codingcode-test-home-'): TempHome {
  let home = '';
  let prev: HomeSnapshot = { HOME: undefined, USERPROFILE: undefined };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), prefix));
    prev = setFakeHome(home);
  });

  afterEach(() => {
    restoreHome(prev);
    rmSync(home, { recursive: true, force: true });
  });

  return {
    get home() {
      return home;
    },
    get configDir() {
      return join(home, '.codingcode');
    },
  };
}
