import { ipcMain, BrowserWindow, dialog } from 'electron'
import { randomUUID } from 'crypto'
import { runAgent, abortAgent, approveToolCall, rejectToolCall } from '../core/agent-loop'
import { storeService } from '../core/store.service'
import { listModels, switchModel, getOrCreateClient, deleteClient } from '../core/backend'
import { readUIHistory, deleteSession, listSessions } from '@codingcode/core'
import type { Project } from '../../shared/types'

export function registerAgentHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('agent:sendMessage', (_e, threadId: string, turnId: string, message: string, cwd?: string) => {
    const win = getMainWindow()
    if (!win) return ''
    const workspace = storeService.getWorkspace()
    const runCwd = cwd || workspace.rootPath || process.cwd()
    runAgent({ threadId, turnId, userMessage: message, cwd: runCwd, win }).catch((err) => {
      if (!win.isDestroyed()) {
        win.webContents.send('agent:done', { threadId, turnId, error: String(err) })
      }
    })
    return runCwd
  })

  ipcMain.handle('agent:abort', (_e, threadId: string) => {
    abortAgent(threadId)
  })

  ipcMain.handle('agent:approveTool', (_e, threadId: string, callId: string) => {
    return approveToolCall(threadId, callId)
  })

  ipcMain.handle('agent:rejectTool', (_e, threadId: string, callId: string) => {
    return rejectToolCall(threadId, callId)
  })

  ipcMain.handle('agent:getThreads', async () => {
    const sessionIds = storeService.getAllSessionIds()
    const entries = Object.entries(sessionIds)
    if (entries.length === 0) return []
    const sessions = listSessions()
    const sessionToThread = new Map(entries.map(([tid, sid]) => [sid, tid]))
    return sessions
      .filter((s) => sessionToThread.has(s.sessionId))
      .map((s) => ({
        id: sessionToThread.get(s.sessionId)!,
        projectId: '',
        title: s.title,
        cwd: s.cwd,
        turns: [],
        createdAt: new Date(s.createdAt).getTime(),
        updatedAt: new Date(s.updatedAt).getTime(),
      }))
  })

  ipcMain.handle('agent:deleteThread', async (_e, threadId: string) => {
    const sessionId = storeService.getSessionId(threadId)
    if (sessionId) {
      deleteSession(sessionId)
      storeService.removeSessionId(threadId)
    }
    deleteClient(threadId)
  })

  ipcMain.handle('agent:loadHistory', async (_e, threadId: string) => {
    const sessionId = storeService.getSessionId(threadId)
    if (!sessionId) return []
    return readUIHistory(sessionId)
  })

  ipcMain.handle('agent:getModels', async () => {
    const { models } = await listModels()
    return models.map((m: Record<string, unknown>) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      context_window: m.context_window,
    }))
  })

  ipcMain.handle('agent:setModel', async (_e, modelId: string) => {
    await switchModel(modelId)
  })

  ipcMain.handle('agent:setApprovalPolicy', (_e, policy: 'suggest' | 'auto-edit' | 'full-auto') => {
    storeService.setApprovalPolicy(policy)
  })

  ipcMain.handle('agent:getSettings', async () => {
    const workspace = storeService.getWorkspace()
    const { activeId } = await listModels()
    return {
      activeModel: activeId ?? '',
      approvalPolicy: storeService.getApprovalPolicy(),
      workspace,
      currentProjectId: storeService.getCurrentProjectId(),
    }
  })

  ipcMain.handle('agent:compressContext', async (_e, threadId: string) => {
    const client = await getOrCreateClient(threadId)
    await client.compact()
  })

  ipcMain.handle('project:getAll', () => {
    return storeService.getProjects()
  })

  ipcMain.handle('project:openFolderDialog', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'], title: '选择项目文件夹' })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('project:add', (_e, rootPath: string) => {
    const name = rootPath.replace(/\\/g, '/').split('/').pop() || rootPath
    const project: Project = { id: randomUUID(), name, rootPath }
    storeService.addProject(project)
    return project
  })

  ipcMain.handle('project:remove', (_e, projectId: string) => {
    storeService.removeProject(projectId)
  })

  ipcMain.handle('project:setCurrentId', (_e, projectId: string) => {
    storeService.setCurrentProjectId(projectId)
  })
}
