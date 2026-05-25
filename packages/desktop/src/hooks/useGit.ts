import { useEffect } from 'react'
import { useGlobalStore } from '../stores/global.store'
import type { GitStatus } from '@shared/types'

export function useGit() {
  const setGit = useGlobalStore((s) => s.setGit)
  const git = useGlobalStore((s) => s.git)

  useEffect(() => {
    // Load initial status
    window.electronAPI?.gitStatus?.().then((status) => {
      if (status) setGit(status as GitStatus)
    })

    const off = window.electronAPI?.onGitStatusUpdate?.((status) => {
      setGit(status as GitStatus)
    })

    return () => off?.()
  }, [setGit])

  const switchBranch = async (branch: string) => {
    await window.electronAPI?.gitSwitchBranch?.(branch)
    const status = await window.electronAPI?.gitStatus?.()
    if (status) setGit(status as GitStatus)
  }

  const getBranches = () => window.electronAPI?.gitBranches?.() ?? Promise.resolve([])

  return { git, switchBranch, getBranches }
}
