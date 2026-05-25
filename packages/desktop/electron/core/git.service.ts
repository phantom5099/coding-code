import simpleGit from 'simple-git'
import type { BrowserWindow } from 'electron'
import type { GitStatus } from '@shared/types'

let pollInterval: ReturnType<typeof setInterval> | null = null
let currentCwd = ''

export async function getStatus(cwd: string): Promise<GitStatus> {
  try {
    const git = simpleGit(cwd)
    const [status, branch] = await Promise.all([
      git.status(),
      git.revparse(['--abbrev-ref', 'HEAD']).catch(() => 'unknown'),
    ])
    return {
      branch: branch.trim(),
      isDirty: !status.isClean(),
      staged: status.staged,
      unstaged: [...status.modified, ...status.deleted, ...status.not_added],
    }
  } catch {
    return { branch: 'unknown', isDirty: false, staged: [], unstaged: [] }
  }
}

export async function getBranches(cwd: string): Promise<string[]> {
  try {
    const git = simpleGit(cwd)
    const result = await git.branchLocal()
    return result.all
  } catch {
    return []
  }
}

export async function switchBranch(cwd: string, branch: string): Promise<void> {
  const git = simpleGit(cwd)
  await git.checkout(branch)
}

export function startPolling(win: BrowserWindow, getCwd: () => string): void {
  stopPolling()
  pollInterval = setInterval(async () => {
    const cwd = getCwd()
    if (!cwd) return
    const status = await getStatus(cwd)
    if (!win.isDestroyed()) {
      win.webContents.send('git:statusUpdate', status)
    }
  }, 5000)
}

export function stopPolling(): void {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}
