import type { FileNode, GitStatus, Item } from '../shared/types'

export interface IpcChannels {
  ping: () => Promise<string>
  'fs:readFile': (path: string) => Promise<string>
  'fs:writeFile': (path: string, content: string) => Promise<void>
  'fs:readDir': (dir: string) => Promise<FileNode[]>
  'fs:watch': (dir: string) => Promise<string>
  'fs:unwatch': (watchId: string) => Promise<void>
  'fs:index': (query: string) => Promise<FileNode[]>
  'pty:create': (id: string, cwd: string, shell?: string) => Promise<void>
  'pty:write': (id: string, data: string) => Promise<void>
  'pty:resize': (id: string, cols: number, rows: number) => Promise<void>
  'pty:kill': (id: string) => Promise<void>
  'agent:sendMessage': (
    threadId: string,
    message: string,
    attachments?: string[]
  ) => Promise<void>
  'agent:abort': (threadId: string) => Promise<void>
  'agent:approveTool': (threadId: string, callId: string) => Promise<void>
  'agent:rejectTool': (threadId: string, callId: string) => Promise<void>
  'git:status': () => Promise<GitStatus>
  'git:branches': () => Promise<string[]>
  'git:switchBranch': (branch: string) => Promise<void>
}

export interface IpcEvents {
  'fs:change': (payload: { path: string; type: 'add' | 'change' | 'unlink' }) => void
  'pty:data': (payload: { id: string; data: string }) => void
  'agent:chunk': (payload: { threadId: string; turnId: string; chunk: Item }) => void
  'agent:done': (payload: { threadId: string; turnId: string }) => void
  'git:statusUpdate': (status: GitStatus) => void
}
