import { ipcMain, BrowserWindow } from 'electron'
import { runAgent, abortAgent, approveToolCall, rejectToolCall } from '../core/agent-loop'
import { storeService } from '../core/store.service'
import { listModels, switchModel, getOrCreateClient } from '../core/backend'

export function registerAgentHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('agent:sendMessage', (_e, threadId: string, turnId: string, message: string, cwd?: string) => {
    const win = getMainWindow()
    if (!win) return
    const workspace = storeService.getWorkspace()
    const runCwd = cwd || workspace.rootPath || process.cwd()
    runAgent({ threadId, turnId, userMessage: message, cwd: runCwd, win }).catch((err) => {
      if (!win.isDestroyed()) {
        win.webContents.send('agent:done', { threadId, turnId, error: String(err) })
      }
    })
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

  ipcMain.handle('agent:getThreads', () => {
    return storeService.getAllThreads()
  })

  ipcMain.handle('agent:deleteThread', (_e, threadId: string) => {
    storeService.deleteThread(threadId)
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
    }
  })

  ipcMain.handle('agent:compressContext', async (_e, threadId: string) => {
    const client = await getOrCreateClient(threadId)
    await client.compact()
  })
}
