import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { FileNode, OpenFile } from '@shared/types';
import { createDebouncedStorage } from './storage';

interface FilesState {
  tree: FileNode[];
  activeFilePath: string | null;
  openFiles: OpenFile[];
}

interface FilesActions {
  setFileTree: (tree: FileNode[]) => void;
  setActiveFile: (path: string | null) => void;
  openFile: (path: string) => void;
  closeFile: (path: string) => void;
  setFileDirty: (path: string, isDirty: boolean) => void;
}

export const useFilesStore = create<FilesState & FilesActions>()(
  persist(
    immer((set) => ({
      tree: [],
      activeFilePath: null,
      openFiles: [],

      setFileTree: (tree) =>
        set((s) => {
          s.tree = tree;
        }),
      setActiveFile: (path) =>
        set((s) => {
          s.activeFilePath = path;
        }),
      openFile: (path) =>
        set((s) => {
          if (!s.openFiles.find((f) => f.path === path)) {
            s.openFiles.push({ path, isDirty: false });
          }
          s.activeFilePath = path;
        }),
      closeFile: (path) =>
        set((s) => {
          s.openFiles = s.openFiles.filter((f) => f.path !== path);
          if (s.activeFilePath === path) {
            const last = s.openFiles[s.openFiles.length - 1];
            s.activeFilePath = last ? last.path : null;
          }
        }),
      setFileDirty: (path, isDirty) =>
        set((s) => {
          const f = s.openFiles.find((f) => f.path === path);
          if (f) f.isDirty = isDirty;
        }),
    })),
    {
      name: 'codingcode-files-store',
      storage: createJSONStorage(() => createDebouncedStorage()),
      partialize: (state) => ({ openFiles: state.openFiles }),
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as any),
        tree: [],
        activeFilePath: null,
      }),
    }
  )
);
