import { useEffect } from 'react';
import { useWorkspaceStore } from '../stores/workspace.store';
import type { GitStatus } from '@shared/types';

export function useGit() {
  const setGit = useWorkspaceStore((s) => s.setGit);
  const git = useWorkspaceStore((s) => s.git);
  const rootPath = useWorkspaceStore((s) => s.rootPath);

  useEffect(() => {
    if (!rootPath) return;
    window.electronAPI?.gitStatus?.(rootPath).then((status) => {
      if (status) setGit(status as GitStatus);
    });

    const off = window.electronAPI?.onGitStatusUpdate?.((status) => {
      setGit(status as GitStatus);
    });

    return () => {
      off?.();
    };
  }, [setGit, rootPath]);

  const switchBranch = async (branch: string) => {
    if (!rootPath) return;
    await window.electronAPI?.gitSwitchBranch?.(rootPath, branch);
    const status = await window.electronAPI?.gitStatus?.(rootPath);
    if (status) setGit(status as GitStatus);
  };

  const getBranches = () => {
    if (!rootPath) return Promise.resolve([]);
    return window.electronAPI?.gitBranches?.(rootPath) ?? Promise.resolve([]);
  };

  return { git, switchBranch, getBranches };
}
