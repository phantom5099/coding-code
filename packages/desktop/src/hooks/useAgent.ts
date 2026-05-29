import { useEffect, useCallback, useRef } from 'react'
import { useGlobalStore, type ModelEntry } from '../stores/global.store'
import { streamAgentMessage, type StreamEvent } from '../lib/agent-stream'
import { listModels, listSessions, getSessionHistory, createSession as createServerSession, deleteSession, sendApprovalResponse, getCheckpointDiff, revertCheckpointFile, revertCheckpointFiles, revertCheckpointAgentFiles, revertCheckpointAllFiles, previewRollbackDiff, rollbackCodeToTurn, rollbackContext, rollbackBothToTurn, undoLastCodeRollback, getRollbackState, forkSession } from '../lib/core-api'
import type { CheckpointDiff, CodeRollbackResult, CodeRollbackUndoResult, RollbackPreviewDiff, SessionRollbackState } from '../lib/core-api'
import type { Item, Turn, Project } from '@shared/types'

function normalizeCwd(p: string): string {
  return p.replace(/\\/g, '/').replace(/^([A-Z]):/, (_, l: string) => `${l.toLowerCase()}:`)
}

function randomId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 11)
}

export function useAgent() {
  const startTurn = useGlobalStore((s) => s.startTurn)
  const applyChunk = useGlobalStore((s) => s.applyChunk)
  const completeTurn = useGlobalStore((s) => s.completeTurn)
  const applyTodoUpdate = useGlobalStore((s) => s.applyTodoUpdate)
  const setCurrentThread = useGlobalStore((s) => s.setCurrentThread)
  const loadThreads = useGlobalStore((s) => s.loadThreads)
  const setThreadTurns = useGlobalStore((s) => s.setThreadTurns)
  const setThreadCwd = useGlobalStore((s) => s.setThreadCwd)
  const setModel = useGlobalStore((s) => s.setModel)
  const setModels = useGlobalStore((s) => s.setModels)
  const setApprovalPolicy = useGlobalStore((s) => s.setApprovalPolicy)
  const setContextUsage = useGlobalStore((s) => s.setContextUsage)
  const setProjects = useGlobalStore((s) => s.setProjects)
  const switchProject = useGlobalStore((s) => s.switchProject)
  const addProject = useGlobalStore((s) => s.addProject)
  const setWorkspace = useGlobalStore((s) => s.setWorkspace)
  const updateToolCallStatus = useGlobalStore((s) => s.updateToolCallStatus)
  const workspace = useGlobalStore((s) => s.workspace)
  const currentThreadId = useGlobalStore((s) => s.agent.currentThreadId)
  const approvalPolicy = useGlobalStore((s) => s.agent.approvalPolicy)
  // Rollback store
  const rollbackStateByThreadId = useGlobalStore((s) => s.rollback.rollbackStateByThreadId)
  const revertedFilesByTurnId = useGlobalStore((s) => s.rollback.revertedFilesByTurnId)
  const setRollbackState = useGlobalStore((s) => s.setRollbackState)
  const setCheckpointDiff = useGlobalStore((s) => s.setCheckpointDiff)
  const setRollbackPreview = useGlobalStore((s) => s.setRollbackPreview)
  const clearRollbackPreview = useGlobalStore((s) => s.clearRollbackPreview)
  const markFileReverted = useGlobalStore((s) => s.markFileReverted)
  const markFileRestored = useGlobalStore((s) => s.markFileRestored)
  const markScopeReverted = useGlobalStore((s) => s.markScopeReverted)
  const markScopeRestored = useGlobalStore((s) => s.markScopeRestored)
  const initRevertedFilesFromState = useGlobalStore((s) => s.initRevertedFilesFromState)

  const abortControllers = useRef<Map<string, AbortController>>(new Map())

  // Load sessions, models, and projects on mount
  useEffect(() => {
    // Load models from HTTP
    listModels().then((data) => {
      if (data.models) setModels(data.models)
      if (data.activeId) setModel(data.activeId)
    }).catch(() => {})

    // Load sessions for current project from HTTP
    const currentCwd = workspace.rootPath
    if (currentCwd) {
      listSessions(currentCwd).then((sessions) => {
        const threads = sessions.map((s: any) => ({
          id: s.sessionId,
          projectId: '',
          title: s.title ?? s.sessionId.slice(0, 8),
          cwd: normalizeCwd(s.cwd ?? ''),
          turns: [],
          createdAt: new Date(s.createdAt).getTime(),
          updatedAt: new Date(s.updatedAt).getTime(),
        }))
        loadThreads(threads)
      }).catch(() => {})
    }

    // Restore persisted projects, approval policy, model - already done by persist middleware
  }, [loadThreads, setModel, setModels, workspace.rootPath])

  // Load history from HTTP when switching to a thread with no turns
  useEffect(() => {
    if (!currentThreadId) return
    const thread = useGlobalStore.getState().agent.threads[currentThreadId]
    if (!thread || thread.turns.length > 0) return
    getSessionHistory(currentThreadId).then((turns) => {
      if (turns && turns.length > 0) {
        setThreadTurns(currentThreadId, turns as any)
      }
    }).catch(() => {})
  }, [currentThreadId, setThreadTurns])

  const streamChunkToItem = useCallback((event: StreamEvent, threadId: string, assistantMessageId: string): Item | null => {
    switch (event.type) {
      case 'text':
        return { id: assistantMessageId, type: 'message', role: 'assistant', content: event.text, partial: true }
      case 'message':
        return { id: assistantMessageId, type: 'message', role: 'assistant', content: event.content, partial: false }
      case 'step':
        return null
      case 'tool_start':
        return { id: randomId(), type: 'tool_call', name: event.name, args: event.args, status: 'running' }
      case 'approval_request':
        return { id: event.id, type: 'tool_call', name: event.tool, args: event.args, status: 'pending' }
      case 'tool_result':
        return { id: randomId(), type: 'tool_result', callId: event.id, name: event.name, output: event.output, exitCode: event.ok ? 0 : 1 }
      case 'tool_denied':
        return { id: randomId(), type: 'tool_call', name: event.name, args: {}, status: 'rejected' }
      case 'error':
        return { id: randomId(), type: 'error', message: event.message }
      case 'todo_update':
        applyTodoUpdate(threadId, event.items)
        return null
      case 'done':
      case 'session_id':
      case 'complete':
        return null
    }
  }, [applyTodoUpdate])

  const sendMessage = useCallback(
    async (threadId: string, content: string, cwd?: string) => {
      const effectiveCwd = cwd || workspace.rootPath || ''

      // Resolve the server session ID. If this is a new thread (no existing turns),
      // create a session on the server first so threadId == sessionId.
      let resolvedThreadId = threadId
      const existingThread = useGlobalStore.getState().agent.threads[threadId]
      const isNewThread = !existingThread || existingThread.turns.length === 0

      if (isNewThread) {
        try {
          const data = await createServerSession(effectiveCwd)
          resolvedThreadId = data.sessionId
        } catch (e) {
          console.error('Failed to create session:', e)
          return
        }
      }

      const turnId = randomId()
      const assistantMessageId = randomId()
      const userItem: Item = { id: randomId(), type: 'message', role: 'user', content }
      const turn: Turn = { id: turnId, items: [userItem], status: 'running' }

      startTurn(resolvedThreadId, turn, { cwd: effectiveCwd, title: content.slice(0, 60) })
      setCurrentThread(resolvedThreadId)
      setContextUsage(null)

      const controller = new AbortController()
      abortControllers.current.set(resolvedThreadId, controller)

      try {
        const stream = streamAgentMessage(content, effectiveCwd, resolvedThreadId, controller.signal)

        for await (const event of stream) {
          if (event.type === 'session_id') {
            continue
          }

          const item = streamChunkToItem(event, resolvedThreadId, assistantMessageId)
          if (item) {
            applyChunk(resolvedThreadId, turnId, item)
          }
        }

        completeTurn(resolvedThreadId, turnId, 'completed')
      } catch (err: any) {
        completeTurn(resolvedThreadId, turnId, 'error')
      } finally {
        abortControllers.current.delete(resolvedThreadId)
      }
    },
    [startTurn, setCurrentThread, setContextUsage, streamChunkToItem, applyChunk, completeTurn, workspace.rootPath]
  )

  const abort = useCallback((threadId: string) => {
    const controller = abortControllers.current.get(threadId)
    if (controller) {
      controller.abort()
      abortControllers.current.delete(threadId)
    }
  }, [])

  const approveTool = useCallback(async (threadId: string, callId: string) => {
    updateToolCallStatus(threadId, callId, 'running')
    await sendApprovalResponse(threadId, callId, 'allow').catch(() => {})
  }, [updateToolCallStatus])

  const rejectTool = useCallback(async (threadId: string, callId: string) => {
    updateToolCallStatus(threadId, callId, 'rejected')
    await sendApprovalResponse(threadId, callId, 'deny').catch(() => {})
  }, [updateToolCallStatus])

  const deleteThread = useCallback(
    async (threadId: string) => {
      await deleteSession(threadId).catch(() => {})
      const currentCwd = useGlobalStore.getState().workspace.rootPath
      if (currentCwd) {
        const sessions = await listSessions(currentCwd).catch(() => [])
        if (sessions) {
          const threads = sessions.map((s: any) => ({
            id: s.sessionId,
            projectId: '',
            title: s.title ?? s.sessionId.slice(0, 8),
            cwd: normalizeCwd(s.cwd ?? ''),
            turns: [],
            createdAt: new Date(s.createdAt).getTime(),
            updatedAt: new Date(s.updatedAt).getTime(),
          }))
          loadThreads(threads)
        }
      }
    },
    [loadThreads]
  )

  const createSession = useCallback(async (cwd: string): Promise<string> => {
    const initialMode = approvalPolicy === 'suggest' ? 'default'
      : approvalPolicy === 'auto-edit' ? 'acceptEdits'
      : 'dontAsk'

    const data = await createServerSession(cwd, initialMode)
    return data.sessionId
  }, [approvalPolicy])

  // Rollback methods
  const loadCheckpointDiff = useCallback(async (threadId: string) => {
    const cwd = useGlobalStore.getState().agent.threads[threadId]?.cwd ?? workspace.rootPath
    const diff = await getCheckpointDiff(threadId, cwd)
    setCheckpointDiff(threadId, String(diff.turnId), diff)
    return diff
  }, [workspace.rootPath, setCheckpointDiff])

  const revertFile = useCallback(async (threadId: string, file: string) => {
    const cwd = useGlobalStore.getState().agent.threads[threadId]?.cwd ?? workspace.rootPath
    const { result } = await revertCheckpointFile(threadId, cwd, file)
    if (result.reverted) {
      markFileReverted(threadId, String(result.throughTurnId), file)
    }
    return result
  }, [workspace.rootPath, markFileReverted])

  const revertFiles = useCallback(async (threadId: string, files: string[]) => {
    const cwd = useGlobalStore.getState().agent.threads[threadId]?.cwd ?? workspace.rootPath
    const { result } = await revertCheckpointFiles(threadId, cwd, files)
    if (result.reverted) {
      for (const f of result.selectedFiles) {
        markFileReverted(threadId, String(result.throughTurnId), f)
      }
    }
    return result
  }, [workspace.rootPath, markFileReverted])

  const revertAgentFiles = useCallback(async (threadId: string) => {
    const cwd = useGlobalStore.getState().agent.threads[threadId]?.cwd ?? workspace.rootPath
    const { result } = await revertCheckpointAgentFiles(threadId, cwd)
    if (result.reverted) {
      markScopeReverted(threadId, String(result.throughTurnId), 'agent')
    }
    return result
  }, [workspace.rootPath, markScopeReverted])

  const revertAllFiles = useCallback(async (threadId: string) => {
    const cwd = useGlobalStore.getState().agent.threads[threadId]?.cwd ?? workspace.rootPath
    const { result } = await revertCheckpointAllFiles(threadId, cwd)
    if (result.reverted) {
      markScopeReverted(threadId, String(result.throughTurnId), 'all')
    }
    return result
  }, [workspace.rootPath, markScopeReverted])

  const previewRollback = useCallback(async (threadId: string, throughTurnId: number) => {
    const cwd = useGlobalStore.getState().agent.threads[threadId]?.cwd ?? workspace.rootPath
    const preview = await previewRollbackDiff(threadId, cwd, throughTurnId)
    setRollbackPreview(threadId, preview)
    return preview
  }, [workspace.rootPath, setRollbackPreview])

  const rollbackCode = useCallback(async (threadId: string, throughTurnId: number) => {
    const cwd = useGlobalStore.getState().agent.threads[threadId]?.cwd ?? workspace.rootPath
    const { result } = await rollbackCodeToTurn(threadId, cwd, throughTurnId)
    return result
  }, [workspace.rootPath])

  const rollbackCtx = useCallback(async (threadId: string, throughTurnId: number) => {
    const cwd = useGlobalStore.getState().agent.threads[threadId]?.cwd ?? workspace.rootPath
    const res = await rollbackContext(threadId, cwd, throughTurnId)
    setThreadTurns(threadId, res.turns as Turn[])
    return res
  }, [workspace.rootPath, setThreadTurns])

  const rollbackBoth = useCallback(async (threadId: string, throughTurnId: number) => {
    const cwd = useGlobalStore.getState().agent.threads[threadId]?.cwd ?? workspace.rootPath
    const res = await rollbackBothToTurn(threadId, cwd, throughTurnId)
    setThreadTurns(threadId, res.turns as Turn[])
    return res
  }, [workspace.rootPath, setThreadTurns])

  const undoCodeRollback = useCallback(async (threadId: string, force?: boolean, files?: string[]) => {
    const cwd = useGlobalStore.getState().agent.threads[threadId]?.cwd ?? workspace.rootPath
    const { result } = await undoLastCodeRollback(threadId, cwd, force, files)
    if (result.restored) {
      for (const f of result.restoredFiles) {
        markFileRestored(threadId, '', f)
      }
    }
    return result
  }, [workspace.rootPath, markFileRestored])

  const forkThread = useCallback(async (threadId: string, atUuid?: string) => {
    const cwd = useGlobalStore.getState().agent.threads[threadId]?.cwd ?? workspace.rootPath
    const res = await forkSession(threadId, cwd, atUuid)
    return res.sessionId
  }, [workspace.rootPath])

  const initRollbackState = useCallback(async (threadId: string) => {
    const cwd = useGlobalStore.getState().agent.threads[threadId]?.cwd ?? workspace.rootPath
    try {
      const state = await getRollbackState(threadId, cwd)
      setRollbackState(threadId, state)
      initRevertedFilesFromState(threadId)
    } catch { /* ignore */ }
  }, [workspace.rootPath, setRollbackState, initRevertedFilesFromState])

  return {
    sendMessage, abort, approveTool, rejectTool, deleteThread, createSession,
    // Rollback
    loadCheckpointDiff, revertFile, revertFiles, revertAgentFiles, revertAllFiles,
    previewRollback, rollbackCode, rollbackCtx, rollbackBoth,
    undoCodeRollback, forkThread, initRollbackState,
    rollbackStateByThreadId, revertedFilesByTurnId,
  }
}
