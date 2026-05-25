export type ItemType = 'message' | 'reasoning' | 'tool_call' | 'tool_result' | 'error'

export type Item =
  | { type: 'message'; role: 'user' | 'assistant'; content: string }
  | { type: 'reasoning'; content: string; isVisible: boolean }
  | {
      type: 'tool_call'
      id: string
      name: string
      args: object
      status: 'pending' | 'approved' | 'rejected' | 'running'
    }
  | { type: 'tool_result'; callId: string; output: string; exitCode?: number }
  | { type: 'error'; message: string }

export interface Turn {
  id: string
  items: Item[]
  status: 'running' | 'completed' | 'error'
}

export interface Thread {
  id: string
  projectId: string
  title: string
  cwd: string
  turns: Turn[]
  model: string
  approvalPolicy: 'suggest' | 'auto-edit' | 'full-auto'
  createdAt: number
  updatedAt: number
}

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

export interface GitStatus {
  branch: string
  isDirty: boolean
  staged: string[]
  unstaged: string[]
}

export interface TerminalSession {
  id: string
  title: string
  cwd: string
}

export interface Project {
  id: string
  name: string
  rootPath: string
  icon?: string
}

export interface OpenFile {
  path: string
  isDirty: boolean
}
