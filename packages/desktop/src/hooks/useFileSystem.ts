import { useEffect } from 'react'
import { useGlobalStore } from '../stores/global.store'
import type { FileNode } from '@shared/types'

export function useFileSystem() {
  const setFileTree = useGlobalStore((s) => s.setFileTree)
  const rootPath = useGlobalStore((s) => s.workspace.rootPath)

  useEffect(() => {
    if (!rootPath) return
    window.electronAPI?.readDir?.(rootPath).then((tree) => {
      setFileTree(tree as FileNode[])
    })
  }, [rootPath, setFileTree])

  const readDir = async (dir: string): Promise<FileNode[]> => {
    const result = await window.electronAPI?.readDir?.(dir)
    return (result as FileNode[]) ?? []
  }

  const searchFiles = async (query: string): Promise<string[]> => {
    return window.electronAPI?.indexFiles?.(query) ?? []
  }

  return { readDir, searchFiles }
}
