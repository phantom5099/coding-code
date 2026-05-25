import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { FileNode, GitStatus, OpenFile, Project, TerminalSession, Thread } from '@shared/types'

interface UIState {
  mode: 'agent' | 'ide'
  sidebarCollapsed: boolean
  sidebarWidth: number
  rightPanelWidth: number
  bottomPanelHeight: number
  ideSidebarView: 'explorer' | 'search' | 'git' | 'extensions'
}

interface WorkspaceState {
  rootPath: string
  name: string
  projects: Project[]
  currentProjectId: string
}

interface FilesState {
  tree: FileNode[]
  activeFilePath: string | null
  openFiles: OpenFile[]
}

interface AgentState {
  currentThreadId: string | null
  threads: Record<string, Thread>
  approvalPolicy: 'suggest' | 'auto-edit' | 'full-auto'
  model: string
  isStreaming: boolean
}

interface EditorState {
  cursorLine: number
  cursorCol: number
}

interface GlobalState {
  ui: UIState
  workspace: WorkspaceState
  files: FilesState
  git: GitStatus
  terminals: TerminalSession[]
  agent: AgentState
  editor: EditorState
}

interface GlobalActions {
  setMode: (mode: 'agent' | 'ide') => void
  toggleSidebar: () => void
  setSidebarWidth: (w: number) => void
  setRightPanelWidth: (w: number) => void
  setBottomPanelHeight: (h: number) => void
  setIdeSidebarView: (view: UIState['ideSidebarView']) => void
  setWorkspace: (rootPath: string, name: string) => void
  setProjects: (projects: Project[]) => void
  setCurrentProject: (id: string) => void
  setFileTree: (tree: FileNode[]) => void
  setActiveFile: (path: string | null) => void
  openFile: (path: string) => void
  closeFile: (path: string) => void
  setFileDirty: (path: string, isDirty: boolean) => void
  setGit: (status: GitStatus) => void
  addTerminal: (session: TerminalSession) => void
  removeTerminal: (id: string) => void
  setCurrentThread: (id: string | null) => void
  upsertThread: (thread: Thread) => void
  setApprovalPolicy: (policy: AgentState['approvalPolicy']) => void
  setModel: (model: string) => void
  setStreaming: (v: boolean) => void
  setCursor: (line: number, col: number) => void
}

const initialGit: GitStatus = {
  branch: 'main',
  isDirty: false,
  staged: [],
  unstaged: [],
}

export const useGlobalStore = create<GlobalState & GlobalActions>()(
  immer((set) => ({
    ui: {
      mode: 'agent',
      sidebarCollapsed: false,
      sidebarWidth: 220,
      rightPanelWidth: 320,
      bottomPanelHeight: 200,
      ideSidebarView: 'explorer',
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
      approvalPolicy: 'suggest',
      model: '',
      isStreaming: false,
    },
    editor: {
      cursorLine: 1,
      cursorCol: 1,
    },

    setMode: (mode) =>
      set((s) => {
        s.ui.mode = mode
      }),
    toggleSidebar: () =>
      set((s) => {
        s.ui.sidebarCollapsed = !s.ui.sidebarCollapsed
      }),
    setSidebarWidth: (w) =>
      set((s) => {
        s.ui.sidebarWidth = w
      }),
    setRightPanelWidth: (w) =>
      set((s) => {
        s.ui.rightPanelWidth = w
      }),
    setBottomPanelHeight: (h) =>
      set((s) => {
        s.ui.bottomPanelHeight = h
      }),
    setIdeSidebarView: (view) =>
      set((s) => {
        s.ui.ideSidebarView = view
      }),
    setWorkspace: (rootPath, name) =>
      set((s) => {
        s.workspace.rootPath = rootPath
        s.workspace.name = name
      }),
    setProjects: (projects) =>
      set((s) => {
        s.workspace.projects = projects
      }),
    setCurrentProject: (id) =>
      set((s) => {
        s.workspace.currentProjectId = id
      }),
    setFileTree: (tree) =>
      set((s) => {
        s.files.tree = tree
      }),
    setActiveFile: (path) =>
      set((s) => {
        s.files.activeFilePath = path
      }),
    openFile: (path) =>
      set((s) => {
        if (!s.files.openFiles.find((f) => f.path === path)) {
          s.files.openFiles.push({ path, isDirty: false })
        }
        s.files.activeFilePath = path
      }),
    closeFile: (path) =>
      set((s) => {
        s.files.openFiles = s.files.openFiles.filter((f) => f.path !== path)
        if (s.files.activeFilePath === path) {
          const last = s.files.openFiles[s.files.openFiles.length - 1]
          s.files.activeFilePath = last ? last.path : null
        }
      }),
    setFileDirty: (path, isDirty) =>
      set((s) => {
        const f = s.files.openFiles.find((f) => f.path === path)
        if (f) f.isDirty = isDirty
      }),
    setGit: (status) =>
      set((s) => {
        s.git = status
      }),
    addTerminal: (session) =>
      set((s) => {
        s.terminals.push(session)
      }),
    removeTerminal: (id) =>
      set((s) => {
        s.terminals = s.terminals.filter((t) => t.id !== id)
      }),
    setCurrentThread: (id) =>
      set((s) => {
        s.agent.currentThreadId = id
      }),
    upsertThread: (thread) =>
      set((s) => {
        s.agent.threads[thread.id] = thread
      }),
    setApprovalPolicy: (policy) =>
      set((s) => {
        s.agent.approvalPolicy = policy
      }),
    setModel: (model) =>
      set((s) => {
        s.agent.model = model
      }),
    setStreaming: (v) =>
      set((s) => {
        s.agent.isStreaming = v
      }),
    setCursor: (line, col) =>
      set((s) => {
        s.editor.cursorLine = line
        s.editor.cursorCol = col
      }),
  }))
)
