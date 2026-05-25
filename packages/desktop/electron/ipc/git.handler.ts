import { ipcMain } from 'electron'
import { getStatus, getBranches, switchBranch } from '../core/git.service'
import { storeService } from '../core/store.service'

const SAFE_BRANCH_RE = /^[a-zA-Z0-9/_.\-]+$/

export function registerGitHandlers(): void {
  ipcMain.handle('git:status', () => {
    const cwd = storeService.getWorkspace().rootPath || process.cwd()
    return getStatus(cwd)
  })

  ipcMain.handle('git:branches', () => {
    const cwd = storeService.getWorkspace().rootPath || process.cwd()
    return getBranches(cwd)
  })

  ipcMain.handle('git:switchBranch', (_e, branch: string) => {
    if (!SAFE_BRANCH_RE.test(branch)) {
      throw new Error(`Invalid branch name: ${branch}`)
    }
    const cwd = storeService.getWorkspace().rootPath || process.cwd()
    return switchBranch(cwd, branch)
  })
}
