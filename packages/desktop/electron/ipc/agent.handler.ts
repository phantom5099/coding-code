import { ipcMain, BrowserWindow } from 'electron'
import { runAgent, abortAgent, approveTool, rejectTool } from '../core/agent-loop'
import { storeService } from '../core/store.service'
import { listAllModels } from '../core/model-config'

export function registerAgentHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('agent:sendMessage', (_e, threadId: string, turnId: string, message: string, cwd?: string, attachments?: string[]) => {
    const win = getMainWindow()
    if (!win) return
    const model = storeService.getActiveModel()
    const policy = storeService.getApprovalPolicy()
    const workspace = storeService.getWorkspace()
    const runCwd = cwd || workspace.rootPath || process.cwd()
    runAgent({ threadId, turnId, userMessage: message, cwd: runCwd, model, policy, win }).catch((err) => {
      if (!win.isDestroyed()) {
        win.webContents.send('agent:done', { threadId, turnId, error: String(err) })
      }
    })
  })

  ipcMain.handle('agent:abort', (_e, threadId: string) => {
    abortAgent(threadId)
  })

  ipcMain.handle('agent:approveTool', (_e, threadId: string, callId: string) => {
    approveTool(threadId, callId)
  })

  ipcMain.handle('agent:rejectTool', (_e, threadId: string, callId: string) => {
    rejectTool(threadId, callId)
  })

  ipcMain.handle('agent:getThreads', () => {
    return storeService.getAllThreads()
  })

  ipcMain.handle('agent:deleteThread', (_e, threadId: string) => {
    storeService.deleteThread(threadId)
  })

  ipcMain.handle('agent:getModels', () => {
    return listAllModels()
  })

  ipcMain.handle('agent:setModel', (_e, modelId: string) => {
    storeService.setActiveModel(modelId)
  })

  ipcMain.handle('agent:setApprovalPolicy', (_e, policy: 'suggest' | 'auto-edit' | 'full-auto') => {
    storeService.setApprovalPolicy(policy)
  })

  ipcMain.handle('agent:getSettings', () => {
    return {
      activeModel: storeService.getActiveModel(),
      approvalPolicy: storeService.getApprovalPolicy(),
    }
  })
}
