import { useEffect, useCallback } from 'react'
import { useGlobalStore } from '../stores/global.store'
import type { ModelEntry } from '../stores/global.store'
import type { Item, Turn } from '@shared/types'

function randomId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 11)
}

export function useAgent() {
  const startTurn = useGlobalStore((s) => s.startTurn)
  const applyChunk = useGlobalStore((s) => s.applyChunk)
  const completeTurn = useGlobalStore((s) => s.completeTurn)
  const setCurrentThread = useGlobalStore((s) => s.setCurrentThread)
  const loadThreads = useGlobalStore((s) => s.loadThreads)
  const setModel = useGlobalStore((s) => s.setModel)
  const setModels = useGlobalStore((s) => s.setModels)
  const setApprovalPolicy = useGlobalStore((s) => s.setApprovalPolicy)
  const setWorkspace = useGlobalStore((s) => s.setWorkspace)
  const setContextUsage = useGlobalStore((s) => s.setContextUsage)
  const workspace = useGlobalStore((s) => s.workspace)

  // Load persisted threads, settings, and models on mount
  useEffect(() => {
    window.electronAPI?.getThreads?.().then((threads) => {
      loadThreads(threads as Parameters<typeof loadThreads>[0])
    })
    window.electronAPI?.getSettings?.().then((settings) => {
      if (settings.activeModel) setModel(settings.activeModel)
      if (settings.approvalPolicy) setApprovalPolicy(settings.approvalPolicy as 'suggest' | 'auto-edit' | 'full-auto')
      if (settings.workspace?.rootPath) setWorkspace(settings.workspace.rootPath, settings.workspace.name)
    })
    window.electronAPI?.getModels?.().then((models) => {
      setModels(models as ModelEntry[])
    })
  }, [loadThreads, setModel, setModels, setApprovalPolicy, setWorkspace])

  // Subscribe to agent events
  useEffect(() => {
    const offChunk = window.electronAPI?.onAgentChunk?.((payload) => {
      applyChunk(payload.threadId, payload.turnId, payload.chunk)
    })
    const offUsage = window.electronAPI?.onAgentUsage?.((payload) => {
      if (payload.threadId === useGlobalStore.getState().agent.currentThreadId) {
        setContextUsage({ used: payload.totalTokens, contextWindow: payload.contextWindow })
      }
    })
    const offDone = window.electronAPI?.onAgentDone?.((payload) => {
      completeTurn(payload.threadId, payload.turnId, payload.error ? 'error' : 'completed')
      if (payload.usage) {
        setContextUsage({ used: payload.usage.totalTokens, contextWindow: payload.usage.contextWindow })
      }
      // Reload threads to get updated title/cwd from main process
      window.electronAPI?.getThreads?.().then((threads) => {
        loadThreads(threads as Parameters<typeof loadThreads>[0])
      })
    })
    return () => {
      offChunk?.()
      offUsage?.()
      offDone?.()
    }
  }, [applyChunk, completeTurn, loadThreads, setContextUsage])

  const sendMessage = useCallback(
    async (threadId: string, content: string, cwd?: string) => {
      const turnId = randomId()
      const userItem: Item = { id: randomId(), type: 'message', role: 'user', content }
      const turn: Turn = { id: turnId, items: [userItem], status: 'running' }
      const effectiveCwd = cwd || workspace.rootPath || undefined
      startTurn(threadId, turn, { cwd: effectiveCwd, title: content.slice(0, 60) })
      setCurrentThread(threadId)
      setContextUsage(null)
      await window.electronAPI?.sendMessage?.(threadId, turnId, content, effectiveCwd)
    },
    [startTurn, setCurrentThread, setContextUsage, workspace.rootPath]
  )

  const abort = useCallback((threadId: string) => {
    window.electronAPI?.abortAgent?.(threadId)
  }, [])

  const approveTool = useCallback((threadId: string, callId: string) => {
    window.electronAPI?.approveTool?.(threadId, callId)
  }, [])

  const rejectTool = useCallback((threadId: string, callId: string) => {
    window.electronAPI?.rejectTool?.(threadId, callId)
  }, [])

  const deleteThread = useCallback(
    async (threadId: string) => {
      await window.electronAPI?.deleteThread?.(threadId)
      const threads = await window.electronAPI?.getThreads?.()
      if (threads) loadThreads(threads as Parameters<typeof loadThreads>[0])
    },
    [loadThreads]
  )

  return { sendMessage, abort, approveTool, rejectTool, deleteThread }
}
