import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { FileNode, GitStatus, Item, OpenFile, Project, TerminalSession, Thread, Turn } from '@shared/types'

export interface ModelEntry {
  id: string
  name: string
  provider: string
  context_window: number
}

interface UIState {
  mode: 'agent' | 'ide'
  view: 'agent' | 'settings'
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
  models: ModelEntry[]
  isStreaming: boolean
  contextUsage: { used: number; contextWindow: number } | null
  // itemId → accumulated streaming text (partial assistant messages)
  streamingContent: Record<string, string>
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
  setView: (view: UIState['view']) => void
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
  setModels: (models: ModelEntry[]) => void
  setContextUsage: (usage: { used: number; contextWindow: number } | null) => void
  setStreaming: (v: boolean) => void
  setCursor: (line: number, col: number) => void
  loadThreads: (threads: Thread[]) => void
  // Fine-grained agent streaming actions
  startTurn: (threadId: string, turn: Turn, meta?: { cwd?: string; title?: string }) => void
  applyChunk: (threadId: string, turnId: string, chunk: Item) => void
  completeTurn: (threadId: string, turnId: string, status: 'completed' | 'error') => void
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
      view: 'agent',
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
      models: [],
      isStreaming: false,
      contextUsage: null,
      streamingContent: {},
    },
    editor: {
      cursorLine: 1,
      cursorCol: 1,
    },

    setMode: (mode) => set((s) => { s.ui.mode = mode }),
    setView: (view) => set((s) => { s.ui.view = view }),
    toggleSidebar: () => set((s) => { s.ui.sidebarCollapsed = !s.ui.sidebarCollapsed }),
    setSidebarWidth: (w) => set((s) => { s.ui.sidebarWidth = w }),
    setRightPanelWidth: (w) => set((s) => { s.ui.rightPanelWidth = w }),
    setBottomPanelHeight: (h) => set((s) => { s.ui.bottomPanelHeight = h }),
    setIdeSidebarView: (view) => set((s) => { s.ui.ideSidebarView = view }),
    setWorkspace: (rootPath, name) => set((s) => { s.workspace.rootPath = rootPath; s.workspace.name = name }),
    setProjects: (projects) => set((s) => { s.workspace.projects = projects }),
    setCurrentProject: (id) => set((s) => { s.workspace.currentProjectId = id }),
    setFileTree: (tree) => set((s) => { s.files.tree = tree }),
    setActiveFile: (path) => set((s) => { s.files.activeFilePath = path }),
    openFile: (path) => set((s) => {
      if (!s.files.openFiles.find((f) => f.path === path)) {
        s.files.openFiles.push({ path, isDirty: false })
      }
      s.files.activeFilePath = path
    }),
    closeFile: (path) => set((s) => {
      s.files.openFiles = s.files.openFiles.filter((f) => f.path !== path)
      if (s.files.activeFilePath === path) {
        const last = s.files.openFiles[s.files.openFiles.length - 1]
        s.files.activeFilePath = last ? last.path : null
      }
    }),
    setFileDirty: (path, isDirty) => set((s) => {
      const f = s.files.openFiles.find((f) => f.path === path)
      if (f) f.isDirty = isDirty
    }),
    setGit: (status) => set((s) => { s.git = status }),
    addTerminal: (session) => set((s) => { s.terminals.push(session) }),
    removeTerminal: (id) => set((s) => { s.terminals = s.terminals.filter((t) => t.id !== id) }),
    setCurrentThread: (id) => set((s) => { s.agent.currentThreadId = id }),
    upsertThread: (thread) => set((s) => { s.agent.threads[thread.id] = thread }),
    setApprovalPolicy: (policy) => set((s) => { s.agent.approvalPolicy = policy }),
    setModel: (model) => set((s) => { s.agent.model = model }),
    setModels: (models) => set((s) => { s.agent.models = models }),
    setContextUsage: (usage) => set((s) => { s.agent.contextUsage = usage }),
    setStreaming: (v) => set((s) => { s.agent.isStreaming = v }),
    setCursor: (line, col) => set((s) => { s.editor.cursorLine = line; s.editor.cursorCol = col }),

    loadThreads: (threads) => set((s) => {
      const incomingIds = new Set(threads.map((t) => t.id))
      const next: Record<string, Thread> = {}
      for (const t of threads) next[t.id] = t
      for (const [id, thread] of Object.entries(s.agent.threads)) {
        if (!incomingIds.has(id) && thread.turns.some((t) => t.status === 'running')) {
          next[id] = thread
        }
      }
      s.agent.threads = next
    }),

    startTurn: (threadId, turn, meta) => set((s) => {
      const thread = s.agent.threads[threadId]
      if (!thread) {
        s.agent.threads[threadId] = {
          id: threadId,
          projectId: '',
          title: meta?.title ?? 'New Conversation',
          cwd: meta?.cwd ?? '',
          turns: [turn],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
      } else {
        thread.turns.push(turn)
        thread.updatedAt = Date.now()
      }
      s.agent.isStreaming = true
    }),

    applyChunk: (threadId, turnId, chunk) => set((s) => {
      const thread = s.agent.threads[threadId]
      if (!thread) return
      const turn = thread.turns.find((t) => t.id === turnId)
      if (!turn) return

      if (chunk.type === 'message' && chunk.role === 'assistant' && chunk.partial) {
        if (!(chunk.id in s.agent.streamingContent)) {
          turn.items.push({ id: chunk.id, type: 'message', role: 'assistant', content: '', partial: true })
        }
        const current = s.agent.streamingContent[chunk.id] ?? ''
        s.agent.streamingContent[chunk.id] = current + chunk.content
        return
      }

      if (chunk.type === 'message' && chunk.role === 'assistant' && chunk.partial === false) {
        // Commit: replace accumulated streaming text with final item
        const fullContent = s.agent.streamingContent[chunk.id] ?? chunk.content
        delete s.agent.streamingContent[chunk.id]
        const existing = turn.items.findIndex((i) => i.id === chunk.id)
        if (existing >= 0) {
          turn.items[existing] = { ...chunk, content: fullContent }
        } else {
          turn.items.push({ ...chunk, content: fullContent })
        }
        return
      }

      if (chunk.type === 'tool_call') {
        const existing = turn.items.findIndex((i) => i.id === chunk.id)
        if (existing >= 0) {
          turn.items[existing] = chunk
        } else {
          turn.items.push(chunk)
        }
        return
      }

      // All other items: append or replace by id
      const existing = turn.items.findIndex((i) => i.id === chunk.id)
      if (existing >= 0) {
        turn.items[existing] = chunk
      } else {
        turn.items.push(chunk)
      }
    }),

    completeTurn: (threadId, turnId, status) => set((s) => {
      const thread = s.agent.threads[threadId]
      if (!thread) return
      const turn = thread.turns.find((t) => t.id === turnId)
      if (turn) {
        turn.status = status
        thread.updatedAt = Date.now()
      }
      s.agent.isStreaming = false
      // Clear any remaining streaming content for items in this turn
      if (turn) {
        for (const item of turn.items) {
          delete s.agent.streamingContent[item.id]
        }
      }
    }),
  }))
)
