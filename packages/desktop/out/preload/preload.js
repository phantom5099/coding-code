"use strict";
const electron = require("electron");
const api = {
  ping: () => electron.ipcRenderer.invoke("ping"),
  // File system
  readFile: (path) => electron.ipcRenderer.invoke("fs:readFile", path),
  writeFile: (path, content) => electron.ipcRenderer.invoke("fs:writeFile", path, content),
  readDir: (dir) => electron.ipcRenderer.invoke("fs:readDir", dir),
  watchDir: (dir) => electron.ipcRenderer.invoke("fs:watch", dir),
  unwatchDir: (watchId) => electron.ipcRenderer.invoke("fs:unwatch", watchId),
  indexFiles: (query) => electron.ipcRenderer.invoke("fs:index", query),
  // Terminal (PTY)
  ptyCreate: (id, cwd, shell) => electron.ipcRenderer.invoke("pty:create", id, cwd, shell),
  ptyWrite: (id, data) => electron.ipcRenderer.invoke("pty:write", id, data),
  ptyResize: (id, cols, rows) => electron.ipcRenderer.invoke("pty:resize", id, cols, rows),
  ptyKill: (id) => electron.ipcRenderer.invoke("pty:kill", id),
  // Agent
  sendMessage: (threadId, message, attachments) => electron.ipcRenderer.invoke("agent:sendMessage", threadId, message, attachments),
  abortAgent: (threadId) => electron.ipcRenderer.invoke("agent:abort", threadId),
  approveTool: (threadId, callId) => electron.ipcRenderer.invoke("agent:approveTool", threadId, callId),
  rejectTool: (threadId, callId) => electron.ipcRenderer.invoke("agent:rejectTool", threadId, callId),
  // Git
  gitStatus: () => electron.ipcRenderer.invoke("git:status"),
  gitBranches: () => electron.ipcRenderer.invoke("git:branches"),
  gitSwitchBranch: (branch) => electron.ipcRenderer.invoke("git:switchBranch", branch),
  // Event listeners (main → renderer)
  onFsChange: (cb) => {
    electron.ipcRenderer.on("fs:change", (_e, payload) => cb(payload));
    return () => electron.ipcRenderer.removeAllListeners("fs:change");
  },
  onPtyData: (cb) => {
    electron.ipcRenderer.on("pty:data", (_e, payload) => cb(payload));
    return () => electron.ipcRenderer.removeAllListeners("pty:data");
  },
  onAgentChunk: (cb) => {
    electron.ipcRenderer.on("agent:chunk", (_e, payload) => cb(payload));
    return () => electron.ipcRenderer.removeAllListeners("agent:chunk");
  },
  onAgentDone: (cb) => {
    electron.ipcRenderer.on("agent:done", (_e, payload) => cb(payload));
    return () => electron.ipcRenderer.removeAllListeners("agent:done");
  },
  onGitStatusUpdate: (cb) => {
    electron.ipcRenderer.on("git:statusUpdate", (_e, status) => cb(status));
    return () => electron.ipcRenderer.removeAllListeners("git:statusUpdate");
  }
};
electron.contextBridge.exposeInMainWorld("electronAPI", api);
