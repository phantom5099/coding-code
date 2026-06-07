import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type {
  FileNode,
  GitStatus,
  Item,
  OpenFile,
  Project,
  TerminalSession,
  Thread,
  Turn,
  TodoItem,
} from '@shared/types';
import type { SessionRollbackState, CheckpointDiff, RollbackPreviewDiff } from '../lib/core-api';
import { buildToolDiff } from '../lib/diff-compute';

function normalizeCwd(p: string): string {
  return p.replace(/\\/g, '/').replace(/^([A-Z]):/, (_, l: string) => `${l.toLowerCase()}:`);
}

export function enrichTurnDiffs(turn: Turn): void {
  for (let i = 0; i < turn.items.length; i++) {
    const item = turn.items[i]!;
    if (item.type !== 'tool_result') continue;
    if ((item as any).diff) continue; // already computed by applyChunk
    const callItem = turn.items.find(
      (j) => j.type === 'tool_call' && j.id === (item as any).callId
    ) as any;
    if (!callItem) continue;
    turn.items[i] = buildToolDiff(item as any, callItem) as any;
  }
}

export interface ModelEntry {
  id: string;
  name: string;
  provider: string;
  context_window: number;
}

interface UIState {
  mode: 'agent' | 'ide';
  view: 'agent' | 'settings';
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  rightPanelWidth: number;
  bottomPanelHeight: number;
  ideSidebarView: 'explorer' | 'search' | 'git' | 'extensions';
  theme: 'dark' | 'light' | 'paper';
}

interface WorkspaceState {
  rootPath: string;
  name: string;
  projects: Project[];
  currentProjectId: string;
}

interface FilesState {
  tree: FileNode[];
  activeFilePath: string | null;
  openFiles: OpenFile[];
}

interface TodoPanelState {
  items: TodoItem[];
  hasSeenNonEmptyTodo: boolean;
  collapsed: boolean;
}

interface AgentState {
  currentThreadId: string | null;
  threads: Record<string, Thread>;
  approvalPolicy: 'ask-all' | 'smart-allow' | 'full-allow' | 'read-only';
  model: string;
  models: ModelEntry[];
  contextUsage: { used: number; contextWindow: number } | null;
  todoByThreadId: Record<string, TodoPanelState>;
  pendingInput: string | null;
  usageByThreadId: Record<string, { prompt: number; completion: number; total: number }>;
  isCompressing: boolean;
  hasRunningTurn: boolean;
}

interface EditorState {
  cursorLine: number;
  cursorCol: number;
}

interface RollbackState {
  rollbackStateByThreadId: Record<string, SessionRollbackState>;
  checkpointDiffByTurnId: Record<string, CheckpointDiff>;
  rollbackPreviewByThreadId: Record<string, RollbackPreviewDiff>;
  revertedFilesByTurnId: Record<string, string[]>;
  turnCheckpointMapping: Record<string, Record<number, string>>;
}

interface GlobalState {
  ui: UIState;
  workspace: WorkspaceState;
  files: FilesState;
  git: GitStatus;
  terminals: TerminalSession[];
  agent: AgentState;
  editor: EditorState;
  rollback: RollbackState;
}

interface GlobalActions {
  setMode: (mode: 'agent' | 'ide') => void;
  setView: (view: UIState['view']) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (w: number) => void;
  setRightPanelWidth: (w: number) => void;
  setBottomPanelHeight: (h: number) => void;
  setIdeSidebarView: (view: UIState['ideSidebarView']) => void;
  setTheme: (theme: UIState['theme']) => void;
  setWorkspace: (rootPath: string, name: string) => void;
  setProjects: (projects: Project[]) => void;
  setCurrentProject: (id: string) => void;
  addProject: (project: Project) => void;
  removeProject: (id: string) => void;
  switchProject: (id: string) => void;
  setFileTree: (tree: FileNode[]) => void;
  setActiveFile: (path: string | null) => void;
  openFile: (path: string) => void;
  closeFile: (path: string) => void;
  setFileDirty: (path: string, isDirty: boolean) => void;
  setGit: (status: GitStatus) => void;
  addTerminal: (session: TerminalSession) => void;
  removeTerminal: (id: string) => void;
  setCurrentThread: (id: string | null) => void;
  upsertThread: (thread: Thread) => void;
  setThreadTurns: (threadId: string, turns: Turn[]) => void;
  setThreadCwd: (threadId: string, cwd: string) => void;
  setApprovalPolicy: (policy: AgentState['approvalPolicy']) => void;
  setModel: (model: string) => void;
  setModels: (models: ModelEntry[]) => void;
  setContextUsage: (usage: { used: number; contextWindow: number } | null) => void;
  setThreadUsage: (
    threadId: string,
    usage: { prompt: number; completion: number; total: number }
  ) => void;
  setCursor: (line: number, col: number) => void;
  loadThreads: (threads: Thread[]) => void;
  updateToolCallStatus: (
    threadId: string,
    callId: string,
    status: 'pending' | 'approved' | 'rejected' | 'running'
  ) => void;
  startTurn: (threadId: string, turn: Turn, meta?: { cwd?: string; title?: string }) => void;
  applyChunk: (threadId: string, turnId: string, chunk: Item) => void;
  updateTurnId: (threadId: string, oldTurnId: string, newTurnId: string) => void;
  completeTurn: (threadId: string, turnId: string, status: 'completed' | 'error') => void;
  setPendingInput: (input: string | null) => void;
  clearRunningTurns: (threadId: string) => void;
  applyTodoUpdate: (threadId: string, items: TodoItem[]) => void;
  toggleTodoCollapsed: (threadId: string) => void;
  // Rollback state
  setRollbackState: (threadId: string, state: SessionRollbackState) => void;
  setCheckpointDiff: (threadId: string, turnId: string, diff: CheckpointDiff) => void;
  setRollbackPreview: (threadId: string, preview: RollbackPreviewDiff) => void;
  clearRollbackPreview: (threadId: string) => void;
  markFileReverted: (threadId: string, turnId: string, file: string) => void;
  markFileRestored: (threadId: string, turnId: string, file: string) => void;
  markScopeReverted: (threadId: string, turnId: string, scope: 'agent' | 'all') => void;
  markScopeRestored: (threadId: string, turnId: string, scope: 'agent' | 'all') => void;
  initRevertedFilesFromState: (threadId: string) => void;
  setTurnCheckpointMapping: (threadId: string, checkpointId: number, uiTurnId: string) => void;
  startCompressing: () => void;
  stopCompressing: () => void;
}

const initialGit: GitStatus = {
  branch: 'main',
  isDirty: false,
  staged: [],
  unstaged: [],
};

// Debounced localStorage adapter to avoid blocking main thread on every set()
let persistDebounceTimer: ReturnType<typeof setTimeout> | undefined;
const debouncedStateStorage = {
  getItem: (name: string): string | null => localStorage.getItem(name),
  setItem: (name: string, value: string): void => {
    clearTimeout(persistDebounceTimer);
    persistDebounceTimer = setTimeout(() => {
      try {
        localStorage.setItem(name, value);
      } catch (e) {
        console.error('Failed to persist state:', e);
      }
    }, 500);
  },
  removeItem: (name: string): void => {
    clearTimeout(persistDebounceTimer);
    localStorage.removeItem(name);
  },
};

export const useGlobalStore = create<GlobalState & GlobalActions>()(
  persist(
    immer((set) => ({
      ui: {
        mode: 'agent',
        view: 'agent',
        sidebarCollapsed: false,
        sidebarWidth: 220,
        rightPanelWidth: 320,
        bottomPanelHeight: 200,
        ideSidebarView: 'explorer',
        theme: 'dark',
      },
      workspace: {
        rootPath: '',
        name: '',
        projects: [],
        currentProjectId: '',
      },
      files: {
        tree: [],
        activeFilePath: null,
        openFiles: [],
      },
      git: initialGit,
      terminals: [],
      agent: {
        currentThreadId: null,
        threads: {},
        approvalPolicy: 'ask-all',
        model: '',
        models: [],
        contextUsage: null,
        todoByThreadId: {},
        pendingInput: null,
        usageByThreadId: {},
        isCompressing: false,
        hasRunningTurn: false,
      },
      editor: {
        cursorLine: 1,
        cursorCol: 1,
      },
      rollback: {
        rollbackStateByThreadId: {},
        checkpointDiffByTurnId: {},
        rollbackPreviewByThreadId: {},
        revertedFilesByTurnId: {},
        turnCheckpointMapping: {},
      },

      setMode: (mode) =>
        set((s) => {
          s.ui.mode = mode;
        }),
      setView: (view) =>
        set((s) => {
          s.ui.view = view;
        }),
      toggleSidebar: () =>
        set((s) => {
          s.ui.sidebarCollapsed = !s.ui.sidebarCollapsed;
        }),
      setSidebarWidth: (w) =>
        set((s) => {
          s.ui.sidebarWidth = w;
        }),
      setRightPanelWidth: (w) =>
        set((s) => {
          s.ui.rightPanelWidth = w;
        }),
      setBottomPanelHeight: (h) =>
        set((s) => {
          s.ui.bottomPanelHeight = h;
        }),
      setIdeSidebarView: (view) =>
        set((s) => {
          s.ui.ideSidebarView = view;
        }),
      setTheme: (theme) =>
        set((s) => {
          s.ui.theme = theme;
        }),
      setWorkspace: (rootPath, name) =>
        set((s) => {
          s.workspace.rootPath = normalizeCwd(rootPath);
          s.workspace.name = name;
        }),
      setProjects: (projects) =>
        set((s) => {
          s.workspace.projects = projects;
        }),
      setCurrentProject: (id) =>
        set((s) => {
          s.workspace.currentProjectId = id;
        }),
      addProject: (project) =>
        set((s) => {
          if (!s.workspace.projects.find((p) => p.id === project.id)) {
            s.workspace.projects.push(project);
          }
        }),
      removeProject: (id) =>
        set((s) => {
          s.workspace.projects = s.workspace.projects.filter((p) => p.id !== id);
        }),
      switchProject: (id) =>
        set((s) => {
          const project = s.workspace.projects.find((p) => p.id === id);
          if (!project) return;
          s.workspace.currentProjectId = id;
          s.workspace.rootPath = normalizeCwd(project.rootPath);
          s.workspace.name = project.name;
          s.agent.currentThreadId = null;
        }),
      setFileTree: (tree) =>
        set((s) => {
          s.files.tree = tree;
        }),
      setActiveFile: (path) =>
        set((s) => {
          s.files.activeFilePath = path;
        }),
      openFile: (path) =>
        set((s) => {
          if (!s.files.openFiles.find((f) => f.path === path)) {
            s.files.openFiles.push({ path, isDirty: false });
          }
          s.files.activeFilePath = path;
        }),
      closeFile: (path) =>
        set((s) => {
          s.files.openFiles = s.files.openFiles.filter((f) => f.path !== path);
          if (s.files.activeFilePath === path) {
            const last = s.files.openFiles[s.files.openFiles.length - 1];
            s.files.activeFilePath = last ? last.path : null;
          }
        }),
      setFileDirty: (path, isDirty) =>
        set((s) => {
          const f = s.files.openFiles.find((f) => f.path === path);
          if (f) f.isDirty = isDirty;
        }),
      setGit: (status) =>
        set((s) => {
          s.git = status;
        }),
      addTerminal: (session) =>
        set((s) => {
          s.terminals.push(session);
        }),
      removeTerminal: (id) =>
        set((s) => {
          s.terminals = s.terminals.filter((t) => t.id !== id);
        }),
      setCurrentThread: (id) =>
        set((s) => {
          s.agent.currentThreadId = id;
          if (id) {
            const usage = s.agent.usageByThreadId[id];
            const model = s.agent.models.find((m) => m.id === s.agent.model);
            if (usage && model) {
              s.agent.contextUsage = { used: usage.total, contextWindow: model.context_window };
            } else {
              s.agent.contextUsage = null;
            }
          } else {
            s.agent.contextUsage = null;
          }
        }),
      upsertThread: (thread) =>
        set((s) => {
          s.agent.threads[thread.id] = thread;
        }),
      setThreadTurns: (threadId, turns) =>
        set((s) => {
          const thread = s.agent.threads[threadId];
          if (thread) {
            for (const turn of turns) enrichTurnDiffs(turn);
            s.agent.threads[threadId] = { ...thread, turns };
          }
        }),
      setThreadCwd: (threadId, cwd) =>
        set((s) => {
          const thread = s.agent.threads[threadId];
          if (thread) thread.cwd = cwd;
        }),
      setApprovalPolicy: (policy) =>
        set((s) => {
          s.agent.approvalPolicy = policy;
        }),
      setModel: (model) =>
        set((s) => {
          s.agent.model = model;
        }),
      setModels: (models) =>
        set((s) => {
          s.agent.models = models;
        }),
      setContextUsage: (usage) =>
        set((s) => {
          s.agent.contextUsage = usage;
        }),
      setThreadUsage: (threadId, usage) =>
        set((s) => {
          s.agent.usageByThreadId[threadId] = usage;
        }),
      setCursor: (line, col) =>
        set((s) => {
          s.editor.cursorLine = line;
          s.editor.cursorCol = col;
        }),

      loadThreads: (threads) =>
        set((s) => {
          const incomingIds = new Set(threads.map((t) => t.id));
          const next: Record<string, Thread> = {};
          for (const t of threads) {
            const existing = s.agent.threads[t.id];
            const targetTurns = existing ? existing.turns : t.turns;
            for (const turn of targetTurns) enrichTurnDiffs(turn);
            next[t.id] = existing ? { ...t, turns: existing.turns } : t;
          }
          for (const [id, thread] of Object.entries(s.agent.threads)) {
            if (!incomingIds.has(id) && thread.turns.some((t) => t.status === 'running')) {
              next[id] = thread;
            }
          }
          s.agent.threads = next;
          // Clean up usage entries for deleted threads
          for (const id of Object.keys(s.agent.usageByThreadId)) {
            if (!incomingIds.has(id)) {
              delete s.agent.usageByThreadId[id];
            }
          }
        }),

      updateToolCallStatus: (threadId, callId, status) =>
        set((s) => {
          const thread = s.agent.threads[threadId];
          if (!thread) return;
          for (const turn of thread.turns) {
            const idx = turn.items.findIndex((i) => i.id === callId && i.type === 'tool_call');
            if (idx >= 0) {
              const existing = turn.items[idx] as Item & { type: 'tool_call' };
              turn.items[idx] = { ...existing, status };
              break;
            }
          }
        }),

      startTurn: (threadId, turn, meta) =>
        set((s) => {
          const thread = s.agent.threads[threadId];
          if (!thread) {
            s.agent.threads[threadId] = {
              id: threadId,
              projectId: '',
              title: meta?.title ?? 'New Conversation',
              cwd: meta?.cwd ? normalizeCwd(meta.cwd) : '',
              turns: [turn],
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
          } else {
            thread.turns.push(turn);
            thread.updatedAt = Date.now();
          }
          s.agent.hasRunningTurn = true;
        }),

      applyChunk: (threadId, turnId, chunk) =>
        set((s) => {
          const thread = s.agent.threads[threadId];
          if (!thread) return;
          const turn = thread.turns.find((t) => t.id === turnId);
          if (!turn) return;

          if (chunk.type === 'message' && chunk.role === 'assistant' && chunk.partial) {
            const existing = turn.items.find((i) => i.id === chunk.id);
            if (existing && existing.type === 'message' && existing.role === 'assistant') {
              existing.content += chunk.content;
              existing.partial = true;
            } else {
              turn.items.push({ ...chunk, partial: true });
            }
            return;
          }

          if (chunk.type === 'message' && chunk.role === 'assistant' && chunk.partial === false) {
            const existing = turn.items.findIndex((i) => i.id === chunk.id);
            if (existing >= 0) {
              const current = turn.items[existing];
              if (!current) return;
              if (current.type === 'message' && current.role === 'assistant') {
                turn.items[existing] = {
                  ...chunk,
                  content: current.content || chunk.content,
                  partial: false,
                };
              } else {
                turn.items[existing] = { ...chunk, partial: false };
              }
            } else {
              turn.items.push({ ...chunk, partial: false });
            }
            return;
          }

          if (chunk.type === 'tool_call') {
            const existing = turn.items.findIndex((i) => i.id === chunk.id);
            if (existing >= 0) {
              turn.items[existing] = chunk;
            } else {
              turn.items.push(chunk);
            }
            return;
          }

          if (chunk.type === 'tool_result') {
            let targetChunk = chunk;
            // Search current turn first (most common case)
            const callIdx = turn.items.findIndex(
              (i) => i.type === 'tool_call' && i.id === chunk.callId
            );
            if (callIdx >= 0) {
              const callItem = turn.items[callIdx] as any;
              callItem.status = 'approved';
              targetChunk = buildToolDiff(chunk, callItem) as any;
              // Push to end instead of splice to avoid shifting existing item indices
              turn.items.push(targetChunk);
              return;
            }
            // Fallback: search other turns (rare)
            for (const t of thread.turns) {
              if (t === turn) continue;
              const otherCallIdx = t.items.findIndex(
                (i) => i.type === 'tool_call' && i.id === chunk.callId
              );
              if (otherCallIdx >= 0) {
                const callItem = t.items[otherCallIdx] as any;
                callItem.status = 'approved';
                targetChunk = buildToolDiff(chunk, callItem) as any;
                t.items.push(targetChunk);
                return;
              }
            }
            turn.items.push(targetChunk);
            return;
          }

          const existing = turn.items.findIndex((i) => i.id === chunk.id);
          if (existing >= 0) {
            turn.items[existing] = chunk;
          } else {
            turn.items.push(chunk);
          }
        }),

      updateTurnId: (threadId, oldTurnId, newTurnId) =>
        set((s) => {
          const thread = s.agent.threads[threadId];
          if (!thread) return;
          const turn = thread.turns.find((t) => t.id === oldTurnId);
          if (!turn) return;
          turn.id = newTurnId;
        }),

      completeTurn: (threadId, turnId, status) =>
        set((s) => {
          const thread = s.agent.threads[threadId];
          if (!thread) return;
          const turn = thread.turns.find((t) => t.id === turnId);
          if (!turn) return;
          turn.status = status;
          thread.updatedAt = Date.now();
          for (const item of turn.items) {
            if (item.type === 'message' && item.role === 'assistant') {
              item.partial = false;
            }
          }
          // Recalculate hasRunningTurn across all threads
          s.agent.hasRunningTurn = Object.values(s.agent.threads).some((t) =>
            t.turns.some((tu) => tu.status === 'running')
          );
        }),

      setPendingInput: (input) =>
        set((s) => {
          s.agent.pendingInput = input;
        }),

      clearRunningTurns: (threadId) =>
        set((s) => {
          const thread = s.agent.threads[threadId];
          if (!thread) return;
          thread.turns = thread.turns.filter((t) => t.status !== 'running');
          s.agent.hasRunningTurn = Object.values(s.agent.threads).some((t) =>
            t.turns.some((tu) => tu.status === 'running')
          );
        }),

      applyTodoUpdate: (threadId, items) =>
        set((s) => {
          const previous = s.agent.todoByThreadId[threadId];
          if (items.length > 0) {
            s.agent.todoByThreadId[threadId] = {
              items,
              hasSeenNonEmptyTodo: true,
              collapsed: previous?.collapsed ?? false,
            };
            return;
          }
          if (previous?.hasSeenNonEmptyTodo) {
            s.agent.todoByThreadId[threadId] = {
              ...previous,
              items: previous.items,
              hasSeenNonEmptyTodo: true,
            };
            return;
          }
          s.agent.todoByThreadId[threadId] = {
            items: [],
            hasSeenNonEmptyTodo: false,
            collapsed: previous?.collapsed ?? false,
          };
        }),

      toggleTodoCollapsed: (threadId) =>
        set((s) => {
          const previous = s.agent.todoByThreadId[threadId];
          if (!previous) return;
          previous.collapsed = !previous.collapsed;
        }),

      // Rollback actions
      setRollbackState: (threadId, state) =>
        set((s) => {
          s.rollback.rollbackStateByThreadId[threadId] = state as any;
        }),
      setCheckpointDiff: (threadId, turnId, diff) =>
        set((s) => {
          s.rollback.checkpointDiffByTurnId[`${threadId}:${turnId}`] = diff as any;
        }),
      setRollbackPreview: (threadId, preview) =>
        set((s) => {
          s.rollback.rollbackPreviewByThreadId[threadId] = preview as any;
        }),
      clearRollbackPreview: (threadId) =>
        set((s) => {
          delete s.rollback.rollbackPreviewByThreadId[threadId];
        }),
      markFileReverted: (threadId, turnId, file) =>
        set((s) => {
          const key = `${threadId}:${turnId}`;
          if (!s.rollback.revertedFilesByTurnId[key]) {
            s.rollback.revertedFilesByTurnId[key] = [];
          }
          if (!s.rollback.revertedFilesByTurnId[key].includes(file)) {
            s.rollback.revertedFilesByTurnId[key].push(file);
          }
        }),
      markFileRestored: (threadId, turnId, file) =>
        set((s) => {
          const key = `${threadId}:${turnId}`;
          const arr = s.rollback.revertedFilesByTurnId[key];
          if (arr) {
            s.rollback.revertedFilesByTurnId[key] = arr.filter((f) => f !== file);
          }
        }),
      markScopeReverted: (threadId, turnId, scope) =>
        set((s) => {
          const key = `${threadId}:${turnId}`;
          const sentinel =
            scope === 'agent' ? '__scope_agent_reverted__' : '__scope_all_reverted__';
          if (!s.rollback.revertedFilesByTurnId[key]) {
            s.rollback.revertedFilesByTurnId[key] = [];
          }
          if (!s.rollback.revertedFilesByTurnId[key].includes(sentinel)) {
            s.rollback.revertedFilesByTurnId[key].push(sentinel);
          }
        }),
      markScopeRestored: (threadId, turnId, scope) =>
        set((s) => {
          const key = `${threadId}:${turnId}`;
          const sentinel =
            scope === 'agent' ? '__scope_agent_reverted__' : '__scope_all_reverted__';
          const arr = s.rollback.revertedFilesByTurnId[key];
          if (arr) {
            s.rollback.revertedFilesByTurnId[key] = arr.filter((f) => f !== sentinel);
            if (s.rollback.revertedFilesByTurnId[key].length === 0) {
              delete s.rollback.revertedFilesByTurnId[key];
            }
          }
        }),
      initRevertedFilesFromState: (threadId) =>
        set((s) => {
          const state = s.rollback.rollbackStateByThreadId[threadId];
          if (!state) return;
          const revertedFiles = state.code.revertedFiles ?? [];
          const checkpointTurnId = state.code.lastEntry?.throughTurnId;
          if (revertedFiles.length === 0 || checkpointTurnId === undefined) return;
          const uiTurnId = s.rollback.turnCheckpointMapping[threadId]?.[checkpointTurnId];
          if (!uiTurnId) return;
          const key = `${threadId}:${uiTurnId}`;
          s.rollback.revertedFilesByTurnId[key] = revertedFiles;
        }),
      setTurnCheckpointMapping: (threadId, checkpointId, uiTurnId) =>
        set((s) => {
          if (!s.rollback.turnCheckpointMapping[threadId]) {
            s.rollback.turnCheckpointMapping[threadId] = {};
          }
          s.rollback.turnCheckpointMapping[threadId][checkpointId] = uiTurnId;
        }),
      startCompressing: () =>
        set((s) => {
          s.agent.isCompressing = true;
        }),
      stopCompressing: () =>
        set((s) => {
          s.agent.isCompressing = false;
        }),
    })),
    {
      name: 'codingcode-desktop-store',
      storage: createJSONStorage(() => debouncedStateStorage),
      partialize: (state) => ({
        ui: {
          mode: state.ui.mode,
          view: state.ui.view,
          sidebarCollapsed: state.ui.sidebarCollapsed,
          sidebarWidth: state.ui.sidebarWidth,
          rightPanelWidth: state.ui.rightPanelWidth,
          bottomPanelHeight: state.ui.bottomPanelHeight,
          ideSidebarView: state.ui.ideSidebarView,
        },
        workspace: {
          rootPath: state.workspace.rootPath,
          name: state.workspace.name,
          projects: state.workspace.projects,
          currentProjectId: state.workspace.currentProjectId,
        },
        files: {
          openFiles: state.files.openFiles,
        },
        agent: {
          approvalPolicy: state.agent.approvalPolicy,
          model: state.agent.model,
        },
        editor: {
          cursorLine: state.editor.cursorLine,
          cursorCol: state.editor.cursorCol,
        },
      }),
      merge: (persisted, current) => {
        const persistedAny = persisted as any;
        // Migrate old approvalPolicy values to new names
        const OLD_POLICY_MAP: Record<string, string> = {
          suggest: 'ask-all',
          'auto-edit': 'smart-allow',
          'full-auto': 'full-allow',
        };
        const rawPolicy = persistedAny?.agent?.approvalPolicy;
        const migratedPolicy = rawPolicy ? (OLD_POLICY_MAP[rawPolicy] ?? rawPolicy) : undefined;
        return {
          ...current,
          ...persistedAny,
          git: initialGit,
          terminals: [],
          files: {
            ...current.files,
            ...persistedAny.files,
            tree: [],
            activeFilePath: null,
          },
          agent: {
            ...current.agent,
            ...persistedAny.agent,
            approvalPolicy: migratedPolicy ?? current.agent.approvalPolicy,
            threads: {},
            todoByThreadId: {},
            contextUsage: null,
            usageByThreadId: {},
          },
        };
      },
    }
  )
);
