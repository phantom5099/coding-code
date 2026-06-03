import { ipcMain } from 'electron';
import { getStatus, getBranches, switchBranch } from '../core/git.service';

const SAFE_BRANCH_RE = /^[a-zA-Z0-9/_.\-]+$/;

export function registerGitHandlers(): void {
  ipcMain.handle('git:status', (_e, cwd: string) => {
    return getStatus(cwd);
  });

  ipcMain.handle('git:branches', (_e, cwd: string) => {
    return getBranches(cwd);
  });

  ipcMain.handle('git:switchBranch', (_e, cwd: string, branch: string) => {
    if (!SAFE_BRANCH_RE.test(branch)) {
      throw new Error(`Invalid branch name: ${branch}`);
    }
    return switchBranch(cwd, branch);
  });
}
