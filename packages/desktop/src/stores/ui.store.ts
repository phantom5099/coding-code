import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { createDebouncedStorage } from './storage';

interface UIState {
  mode: 'agent' | 'ide';
  view: 'agent' | 'global-settings' | 'project-settings' | 'automation';
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  rightPanelWidth: number;
  bottomPanelHeight: number;
  ideSidebarView: 'explorer' | 'search' | 'git' | 'extensions';
  theme: 'dark' | 'light' | 'paper';
}

interface UIActions {
  setMode: (mode: 'agent' | 'ide') => void;
  setView: (view: UIState['view']) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (w: number) => void;
  setRightPanelWidth: (w: number) => void;
  setBottomPanelHeight: (h: number) => void;
  setIdeSidebarView: (view: UIState['ideSidebarView']) => void;
  setTheme: (theme: UIState['theme']) => void;
}

export const useUIStore = create<UIState & UIActions>()(
  persist(
    immer((set) => ({
      mode: 'agent',
      view: 'agent',
      sidebarCollapsed: false,
      sidebarWidth: 220,
      rightPanelWidth: 320,
      bottomPanelHeight: 200,
      ideSidebarView: 'explorer',
      theme: 'dark',

      setMode: (mode) =>
        set((s) => {
          s.mode = mode;
        }),
      setView: (view) =>
        set((s) => {
          s.view = view;
        }),
      toggleSidebar: () =>
        set((s) => {
          s.sidebarCollapsed = !s.sidebarCollapsed;
        }),
      setSidebarWidth: (w) =>
        set((s) => {
          s.sidebarWidth = w;
        }),
      setRightPanelWidth: (w) =>
        set((s) => {
          s.rightPanelWidth = w;
        }),
      setBottomPanelHeight: (h) =>
        set((s) => {
          s.bottomPanelHeight = h;
        }),
      setIdeSidebarView: (view) =>
        set((s) => {
          s.ideSidebarView = view;
        }),
      setTheme: (theme) =>
        set((s) => {
          s.theme = theme;
        }),
    })),
    {
      name: 'codingcode-ui-store',
      storage: createJSONStorage(() => createDebouncedStorage()),
    }
  )
);
