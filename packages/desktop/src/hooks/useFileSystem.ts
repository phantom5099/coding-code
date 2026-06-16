import { useEffect } from 'react';
import { useFilesStore } from '../stores/files.store';
import { useWorkspaceStore } from '../stores/workspace.store';
import type { FileNode } from '@shared/types';

export function useFileSystem() {
  const setFileTree = useFilesStore((s) => s.setFileTree);
  const rootPath = useWorkspaceStore((s) => s.rootPath);

  useEffect(() => {
    if (!rootPath) return;
    window.electronAPI?.readDir?.(rootPath, rootPath).then((tree) => {
      setFileTree(tree as FileNode[]);
    });
  }, [rootPath, setFileTree]);

  const readDir = async (dir: string): Promise<FileNode[]> => {
    if (!rootPath) return [];
    const result = await window.electronAPI?.readDir?.(rootPath, dir);
    return (result as FileNode[]) ?? [];
  };

  const searchFiles = async (query: string): Promise<string[]> => {
    if (!rootPath) return [];
    return window.electronAPI?.indexFiles?.(rootPath, query) ?? [];
  };

  return { readDir, searchFiles };
}
