import { contextBridge, ipcRenderer } from 'electron'

const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('ping'),

  // File system
  readFile: (path: string): Promise<string> => ipcRenderer.invoke('fs:readFile', path),
  writeFile: (path: string, content: string): Promise<void> =>
    ipcRenderer.invoke('fs:writeFile', path, content),
  readDir: (dir: string): Promise<unknown> => ipcRenderer.invoke('fs:readDir', dir),
  watchDir: (dir: string): Promise<string> => ipcRenderer.invoke('fs:watch', dir),
  unwatchDir: (watchId: string): Promise<void> => ipcRenderer.invoke('fs:unwatch', watchId),
  indexFiles: (query: string): Promise<unknown> => ipcRenderer.invoke('fs:index', query),

  // Terminal (PTY)
  ptyCreate: (id: string, cwd: string, shell?: string): Promise<void> =>
    ipcRenderer.invoke('pty:create', id, cwd, shell),
  ptyWrite: (id: string, data: string): Promise<void> =>
    ipcRenderer.invoke('pty:write', id, data),
  ptyResize: (id: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke('pty:resize', id, cols, rows),
  ptyKill: (id: string): Promise<void> => ipcRenderer.invoke('pty:kill', id),

  // Agent
  sendMessage: (threadId: string, message: string, attachments?: string[]): Promise<void> =>
    ipcRenderer.invoke('agent:sendMessage', threadId, message, attachments),
  abortAgent: (threadId: string): Promise<void> =>
    ipcRenderer.invoke('agent:abort', threadId),
  approveTool: (threadId: string, callId: string): Promise<void> =>
    ipcRenderer.invoke('agent:approveTool', threadId, callId),
  rejectTool: (threadId: string, callId: string): Promise<void> =>
    ipcRenderer.invoke('agent:rejectTool', threadId, callId),

  // Git
  gitStatus: (): Promise<unknown> => ipcRenderer.invoke('git:status'),
  gitBranches: (): Promise<string[]> => ipcRenderer.invoke('git:branches'),
  gitSwitchBranch: (branch: string): Promise<void> =>
    ipcRenderer.invoke('git:switchBranch', branch),

  // Event listeners (main → renderer)
  onFsChange: (
    cb: (payload: { path: string; type: 'add' | 'change' | 'unlink' }) => void
  ) => {
    ipcRenderer.on('fs:change', (_e, payload) => cb(payload))
    return () => ipcRenderer.removeAllListeners('fs:change')
  },
  onPtyData: (cb: (payload: { id: string; data: string }) => void) => {
    ipcRenderer.on('pty:data', (_e, payload) => cb(payload))
    return () => ipcRenderer.removeAllListeners('pty:data')
  },
  onAgentChunk: (
    cb: (payload: { threadId: string; turnId: string; chunk: unknown }) => void
  ) => {
    ipcRenderer.on('agent:chunk', (_e, payload) => cb(payload))
    return () => ipcRenderer.removeAllListeners('agent:chunk')
  },
  onAgentDone: (cb: (payload: { threadId: string; turnId: string }) => void) => {
    ipcRenderer.on('agent:done', (_e, payload) => cb(payload))
    return () => ipcRenderer.removeAllListeners('agent:done')
  },
  onGitStatusUpdate: (cb: (status: unknown) => void) => {
    ipcRenderer.on('git:statusUpdate', (_e, status) => cb(status))
    return () => ipcRenderer.removeAllListeners('git:statusUpdate')
  },
}

contextBridge.exposeInMainWorld('electronAPI', api)

export type ElectronAPI = typeof api
