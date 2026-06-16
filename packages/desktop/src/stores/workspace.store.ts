import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { Project, GitStatus } from '@shared/types';
import { createDebouncedStorage, normalizeCwd } from './storage';
import { useAgentStore } from './agent.store';

interface WorkspaceState {
  rootPath: string;
  name: string;
  projects: Project[];
  currentProjectId: string;
  git: GitStatus;
}

interface WorkspaceActions {
  setWorkspace: (rootPath: string, name: string) => void;
  setProjects: (projects: Project[]) => void;
  setCurrentProject: (id: string) => void;
  addProject: (project: Project) => void;
  removeProject: (id: string) => void;
  switchProject: (id: string) => void;
  setGit: (status: GitStatus) => void;
}

const initialGit: GitStatus = {
  branch: 'main',
  isDirty: false,
  staged: [],
  unstaged: [],
};

export const useWorkspaceStore = create<WorkspaceState & WorkspaceActions>()(
  persist(
    immer((set) => ({
      rootPath: '',
      name: '',
      projects: [],
      currentProjectId: '',
      git: initialGit,

      setWorkspace: (rootPath, name) =>
        set((s) => {
          s.rootPath = normalizeCwd(rootPath);
          s.name = name;
        }),

      setProjects: (projects) =>
        set((s) => {
          s.projects = projects;
        }),

      setCurrentProject: (id) =>
        set((s) => {
          s.currentProjectId = id;
        }),

      addProject: (project) =>
        set((s) => {
          if (!s.projects.find((p) => p.id === project.id)) {
            s.projects.push(project);
          }
        }),

      removeProject: (id) =>
        set((s) => {
          s.projects = s.projects.filter((p) => p.id !== id);
        }),

      switchProject: (id) => {
        let found = false;
        set((s) => {
          const project = s.projects.find((p) => p.id === id);
          if (!project) return;
          found = true;
          s.currentProjectId = id;
          s.rootPath = normalizeCwd(project.rootPath);
          s.name = project.name;
        });
        if (found) {
          useAgentStore.getState().setCurrentThread(null);
        }
      },

      setGit: (status) =>
        set((s) => {
          s.git = status;
        }),
    })),
    {
      name: 'codingcode-workspace-store',
      storage: createJSONStorage(() => createDebouncedStorage()),
      merge: (persisted, current) => {
        const p = persisted as any;
        return {
          ...current,
          ...p,
          git: initialGit,
        };
      },
    }
  )
);
