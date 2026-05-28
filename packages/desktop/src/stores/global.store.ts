import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import type { FileNode, GitStatus, Item, OpenFile, Project, TerminalSession, Thread, Turn, TodoItem } from '@shared/types'

function normalizeCwd(p: string): string {
  return p.replace(/\\/g, '/').replace(/^([A-Z]):/, (_, l: string) => `${l.toLowerCase()}:`)
}

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

interface TodoPanelState {
  items: TodoItem[]
  hasSeenNonEmptyTodo: boolean
  collapsed: boolean
}

interface AgentState {
  currentThreadId: string | null
  threads: Record<string, Thread>
  approvalPolicy: 'suggest' | 'auto-edit' | 'full-auto'
  model: string
  models: ModelEntry[]
  contextUsage: { used: number; contextWindow: number } | null
  todoByThreadId: Record<string, TodoPanelState>
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
  addProject: (project: Project) => void
  removeProject: (id: string) => void
  switchProject: (id: string) => void
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
  setThreadTurns: (threadId: string, turns: Turn[]) => void
  setThreadCwd: (threadId: string, cwd: string) => void
  setApprovalPolicy: (policy: AgentState['approvalPolicy']) => void
  setModel: (model: string) => void
  setModels: (models: ModelEntry[]) => void
  setContextUsage: (usage: { used: number; contextWindow: number } | null) => void
  setCursor: (line: number, col: number) => void
  loadThreads: (threads: Thread[]) => void
  updateToolCallStatus: (threadId: string, callId: string, status: 'pending' | 'approved' | 'rejected' | 'running') => void
  startTurn: (threadId: string, turn: Turn, meta?: { cwd?: string; title?: string }) => void
  applyChunk: (threadId: string, turnId: string, chunk: Item) => void
  completeTurn: (threadId: string, turnId: string, status: 'completed' | 'error') => void
  applyTodoUpdate: (threadId: string, items: TodoItem[]) => void
  toggleTodoCollapsed: (threadId: string) => void
}

const initialGit: GitStatus = {
  branch: 'main',
  isDirty: false,
  staged: [],
  unstaged: [],
}

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
        contextUsage: null,
        todoByThreadId: {},
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
      setWorkspace: (rootPath, name) => set((s) => { s.workspace.rootPath = normalizeCwd(rootPath); s.workspace.name = name }),
      setProjects: (projects) => set((s) => { s.workspace.projects = projects }),
      setCurrentProject: (id) => set((s) => { s.workspace.currentProjectId = id }),
      addProject: (project) => set((s) => {
        if (!s.workspace.projects.find((p) => p.id === project.id)) {
          s.workspace.projects.push(project)
        }
      }),
      removeProject: (id) => set((s) => {
        s.workspace.projects = s.workspace.projects.filter((p) => p.id !== id)
      }),
      switchProject: (id) => set((s) => {
        const project = s.workspace.projects.find((p) => p.id === id)
        if (!project) return
        s.workspace.currentProjectId = id
        s.workspace.rootPath = normalizeCwd(project.rootPath)
        s.workspace.name = project.name
        s.agent.currentThreadId = null
      }),
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
      setThreadTurns: (threadId, turns) => set((s) => {
        const thread = s.agent.threads[threadId]
        if (thread) thread.turns = turns
      }),
      setThreadCwd: (threadId, cwd) => set((s) => {
        const thread = s.agent.threads[threadId]
        if (thread) thread.cwd = cwd
      }),
      setApprovalPolicy: (policy) => set((s) => { s.agent.approvalPolicy = policy }),
      setModel: (model) => set((s) => { s.agent.model = model }),
      setModels: (models) => set((s) => { s.agent.models = models }),
      setContextUsage: (usage) => set((s) => { s.agent.contextUsage = usage }),
      setCursor: (line, col) => set((s) => { s.editor.cursorLine = line; s.editor.cursorCol = col }),

      loadThreads: (threads) => set((s) => {
        const incomingIds = new Set(threads.map((t) => t.id))
        const next: Record<string, Thread> = {}
        for (const t of threads) {
          const existing = s.agent.threads[t.id]
          next[t.id] = existing ? { ...t, turns: existing.turns } : t
        }
        for (const [id, thread] of Object.entries(s.agent.threads)) {
          if (!incomingIds.has(id) && thread.turns.some((t) => t.status === 'running')) {
            next[id] = thread
          }
        }
        s.agent.threads = next
      }),

      updateToolCallStatus: (threadId, callId, status) => set((s) => {
        const thread = s.agent.threads[threadId]
        if (!thread) return
        for (const turn of thread.turns) {
          const idx = turn.items.findIndex((i) => i.id === callId && i.type === 'tool_call')
          if (idx >= 0) {
            const existing = turn.items[idx] as Item & { type: 'tool_call' }
            turn.items[idx] = { ...existing, status }
            break
          }
        }
      }),

      startTurn: (threadId, turn, meta) => set((s) => {
        const thread = s.agent.threads[threadId]
        if (!thread) {
          s.agent.threads[threadId] = {
            id: threadId,
            projectId: '',
            title: meta?.title ?? 'New Conversation',
            cwd: meta?.cwd ? normalizeCwd(meta.cwd) : '',
            turns: [turn],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }
        } else {
          thread.turns.push(turn)
          thread.updatedAt = Date.now()
        }
      }),

      applyChunk: (threadId, turnId, chunk) => set((s) => {
        const thread = s.agent.threads[threadId]
        if (!thread) return
        const turn = thread.turns.find((t) => t.id === turnId)
        if (!turn) return

        if (chunk.type === 'message' && chunk.role === 'assistant' && chunk.partial) {
          const existing = turn.items.find((i) => i.id === chunk.id)
          if (existing && existing.type === 'message' && existing.role === 'assistant') {
            existing.content += chunk.content
            existing.partial = true
          } else {
            turn.items.push({ ...chunk, partial: true })
          }
          return
        }

        if (chunk.type === 'message' && chunk.role === 'assistant' && chunk.partial === false) {
          const existing = turn.items.findIndex((i) => i.id === chunk.id)
          if (existing >= 0) {
            const current = turn.items[existing]
            if (!current) return
            if (current.type === 'message' && current.role === 'assistant') {
              turn.items[existing] = { ...chunk, content: current.content || chunk.content, partial: false }
            } else {
              turn.items[existing] = { ...chunk, partial: false }
            }
          } else {
            turn.items.push({ ...chunk, partial: false })
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
        if (!turn) return
        turn.status = status
        thread.updatedAt = Date.now()
        for (const item of turn.items) {
          if (item.type === 'message' && item.role === 'assistant') {
            item.partial = false
          }
        }
      }),

      applyTodoUpdate: (threadId, items) => set((s) => {
        const previous = s.agent.todoByThreadId[threadId]
        if (items.length > 0) {
          s.agent.todoByThreadId[threadId] = {
            items,
            hasSeenNonEmptyTodo: true,
            collapsed: previous?.collapsed ?? false,
          }
          return
        }
        if (previous?.hasSeenNonEmptyTodo) {
          s.agent.todoByThreadId[threadId] = { ...previous, items: previous.items, hasSeenNonEmptyTodo: true }
          return
        }
        s.agent.todoByThreadId[threadId] = {
          items: [],
          hasSeenNonEmptyTodo: false,
          collapsed: previous?.collapsed ?? false,
        }
      }),

      toggleTodoCollapsed: (threadId) => set((s) => {
        const previous = s.agent.todoByThreadId[threadId]
        if (!previous) return
        previous.collapsed = !previous.collapsed
      }),
    })),
    {
      name: 'codingcode-desktop-store',
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
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as any),
        git: initialGit,
        terminals: [],
        files: {
          ...current.files,
          ...(persisted as any).files,
          tree: [],
          activeFilePath: null,
        },
        agent: {
          ...current.agent,
          ...(persisted as any).agent,
          threads: {},
          todoByThreadId: {},
          contextUsage: null,
        },
      }),
    },
  ),
)
