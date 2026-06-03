import { contextBridge, ipcRenderer } from 'electron';

const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('ping'),
  platform: process.platform,

  // File system (explicit rootPath for sandbox enforcement)
  readFile: (rootPath: string, path: string): Promise<string> =>
    ipcRenderer.invoke('fs:readFile', rootPath, path),
  writeFile: (rootPath: string, path: string, content: string): Promise<void> =>
    ipcRenderer.invoke('fs:writeFile', rootPath, path, content),
  readDir: (rootPath: string, dir: string): Promise<unknown> =>
    ipcRenderer.invoke('fs:readDir', rootPath, dir),
  watchDir: (rootPath: string, dir: string): Promise<string> =>
    ipcRenderer.invoke('fs:watch', rootPath, dir),
  unwatchDir: (watchId: string): Promise<void> => ipcRenderer.invoke('fs:unwatch', watchId),
  indexFiles: (rootPath: string, query: string): Promise<string[]> =>
    ipcRenderer.invoke('fs:index', rootPath, query),

  // Terminal (PTY) — explicit cwd
  ptyCreate: (cwd: string, id: string, shell?: string): Promise<void> =>
    ipcRenderer.invoke('pty:create', cwd, id, shell),
  ptyWrite: (id: string, data: string): Promise<void> => ipcRenderer.invoke('pty:write', id, data),
  ptyResize: (id: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke('pty:resize', id, cols, rows),
  ptyKill: (id: string): Promise<void> => ipcRenderer.invoke('pty:kill', id),

  // Folder dialog
  openFolderDialog: (): Promise<string | null> => ipcRenderer.invoke('project:openFolderDialog'),

  // Workspace cwd sync (renderer -> main)
  setWorkspaceCwd: (cwd: string): void => ipcRenderer.send('workspace:setCwd', cwd),

  // Git (explicit cwd)
  gitStatus: (cwd: string): Promise<unknown> => ipcRenderer.invoke('git:status', cwd),
  gitBranches: (cwd: string): Promise<string[]> => ipcRenderer.invoke('git:branches', cwd),
  gitSwitchBranch: (cwd: string, branch: string): Promise<void> =>
    ipcRenderer.invoke('git:switchBranch', cwd, branch),

  // Events: main -> renderer
  onFsChange: (cb: (payload: { path: string; type: 'add' | 'change' | 'unlink' }) => void) => {
    ipcRenderer.on('fs:change', (_e, payload) => cb(payload));
    return () => ipcRenderer.removeAllListeners('fs:change');
  },
  onPtyData: (cb: (payload: { id: string; data: string }) => void) => {
    ipcRenderer.on('pty:data', (_e, payload) => cb(payload));
    return () => ipcRenderer.removeAllListeners('pty:data');
  },
  onGitStatusUpdate: (cb: (status: unknown) => void) => {
    ipcRenderer.on('git:statusUpdate', (_e, status) => cb(status));
    return () => ipcRenderer.removeAllListeners('git:statusUpdate');
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
