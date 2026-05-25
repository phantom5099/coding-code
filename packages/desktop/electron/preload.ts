import { contextBridge, ipcRenderer } from 'electron'
import type { Item } from '../shared/types'

const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('ping'),
  platform: process.platform,

  // File system
  readFile: (path: string): Promise<string> => ipcRenderer.invoke('fs:readFile', path),
  writeFile: (path: string, content: string): Promise<void> => ipcRenderer.invoke('fs:writeFile', path, content),
  readDir: (dir: string): Promise<unknown> => ipcRenderer.invoke('fs:readDir', dir),
  watchDir: (dir: string): Promise<string> => ipcRenderer.invoke('fs:watch', dir),
  unwatchDir: (watchId: string): Promise<void> => ipcRenderer.invoke('fs:unwatch', watchId),
  indexFiles: (query: string): Promise<string[]> => ipcRenderer.invoke('fs:index', query),

  // Terminal (PTY) – reserved for Phase 4
  ptyCreate: (id: string, cwd: string, shell?: string): Promise<void> => ipcRenderer.invoke('pty:create', id, cwd, shell),
  ptyWrite: (id: string, data: string): Promise<void> => ipcRenderer.invoke('pty:write', id, data),
  ptyResize: (id: string, cols: number, rows: number): Promise<void> => ipcRenderer.invoke('pty:resize', id, cols, rows),
  ptyKill: (id: string): Promise<void> => ipcRenderer.invoke('pty:kill', id),

  // Agent
  sendMessage: (threadId: string, turnId: string, message: string, cwd?: string, attachments?: string[]): Promise<void> =>
    ipcRenderer.invoke('agent:sendMessage', threadId, turnId, message, cwd, attachments),
  abortAgent: (threadId: string): Promise<void> => ipcRenderer.invoke('agent:abort', threadId),
  approveTool: (threadId: string, callId: string): Promise<void> => ipcRenderer.invoke('agent:approveTool', threadId, callId),
  rejectTool: (threadId: string, callId: string): Promise<void> => ipcRenderer.invoke('agent:rejectTool', threadId, callId),
  getThreads: (): Promise<unknown[]> => ipcRenderer.invoke('agent:getThreads'),
  deleteThread: (threadId: string): Promise<void> => ipcRenderer.invoke('agent:deleteThread', threadId),
  getModels: (): Promise<unknown[]> => ipcRenderer.invoke('agent:getModels'),
  setModel: (modelId: string): Promise<void> => ipcRenderer.invoke('agent:setModel', modelId),
  setApprovalPolicy: (policy: string): Promise<void> => ipcRenderer.invoke('agent:setApprovalPolicy', policy),
  getSettings: (): Promise<{ activeModel: string; approvalPolicy: string; workspace: { rootPath: string; name: string } }> =>
    ipcRenderer.invoke('agent:getSettings'),
  compressContext: (threadId: string): Promise<void> => ipcRenderer.invoke('agent:compressContext', threadId),

  // Git
  gitStatus: (): Promise<unknown> => ipcRenderer.invoke('git:status'),
  gitBranches: (): Promise<string[]> => ipcRenderer.invoke('git:branches'),
  gitSwitchBranch: (branch: string): Promise<void> => ipcRenderer.invoke('git:switchBranch', branch),

  // Settings (MCP / Skills / Agents)
  getMcp: (): Promise<{name: string; transport: 'stdio'|'http'; disabled: boolean; toolCount: number}[]> =>
    ipcRenderer.invoke('settings:getMcp'),
  setMcpDisabled: (name: string, disabled: boolean): Promise<void> =>
    ipcRenderer.invoke('settings:setMcpDisabled', name, disabled),
  getSkills: (): Promise<{name: string; description: string; disabled: boolean}[]> =>
    ipcRenderer.invoke('settings:getSkills'),
  setSkillDisabled: (name: string, disabled: boolean): Promise<void> =>
    ipcRenderer.invoke('settings:setSkillDisabled', name, disabled),
  getAgents: (): Promise<{name: string; description: string; tools?: string[]; readonly?: boolean; maxSteps?: number; model?: string}[]> =>
    ipcRenderer.invoke('settings:getAgents'),
  getSubagentEnabled: (): Promise<boolean> =>
    ipcRenderer.invoke('settings:getSubagentEnabled'),
  setSubagentEnabled: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('settings:setSubagentEnabled', enabled),

  // Events: main → renderer
  onFsChange: (cb: (payload: { path: string; type: 'add' | 'change' | 'unlink' }) => void) => {
    ipcRenderer.on('fs:change', (_e, payload) => cb(payload))
    return () => ipcRenderer.removeAllListeners('fs:change')
  },
  onPtyData: (cb: (payload: { id: string; data: string }) => void) => {
    ipcRenderer.on('pty:data', (_e, payload) => cb(payload))
    return () => ipcRenderer.removeAllListeners('pty:data')
  },
  onAgentChunk: (cb: (payload: { threadId: string; turnId: string; chunk: Item }) => void) => {
    ipcRenderer.on('agent:chunk', (_e, payload) => cb(payload))
    return () => ipcRenderer.removeAllListeners('agent:chunk')
  },
  onAgentDone: (cb: (payload: { threadId: string; turnId: string; error?: string }) => void) => {
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
