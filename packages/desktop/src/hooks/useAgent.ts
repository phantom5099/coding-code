import { useEffect, useCallback } from 'react'
import { useGlobalStore } from '../stores/global.store'
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
  const setApprovalPolicy = useGlobalStore((s) => s.setApprovalPolicy)

  // Load persisted threads and settings on mount
  useEffect(() => {
    window.electronAPI?.getThreads?.().then((threads) => {
      loadThreads(threads as Parameters<typeof loadThreads>[0])
    })
    window.electronAPI?.getSettings?.().then((settings) => {
      if (settings.activeModel) setModel(settings.activeModel)
      if (settings.approvalPolicy) setApprovalPolicy(settings.approvalPolicy as 'suggest' | 'auto-edit' | 'full-auto')
    })
  }, [loadThreads, setModel, setApprovalPolicy])

  // Subscribe to agent events
  useEffect(() => {
    const offChunk = window.electronAPI?.onAgentChunk?.((payload) => {
      applyChunk(payload.threadId, payload.turnId, payload.chunk)
    })
    const offDone = window.electronAPI?.onAgentDone?.((payload) => {
      completeTurn(payload.threadId, payload.turnId, payload.error ? 'error' : 'completed')
    })
    return () => {
      offChunk?.()
      offDone?.()
    }
  }, [applyChunk, completeTurn])

  const sendMessage = useCallback(
    async (threadId: string, content: string, cwd?: string) => {
      const turnId = randomId()
      const userItem: Item = { id: randomId(), type: 'message', role: 'user', content }
      const turn: Turn = { id: turnId, items: [userItem], status: 'running' }
      startTurn(threadId, turn)
      setCurrentThread(threadId)
      await window.electronAPI?.sendMessage?.(threadId, turnId, content, cwd)
    },
    [startTurn, setCurrentThread]
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
      // Reload threads
      const threads = await window.electronAPI?.getThreads?.()
      if (threads) loadThreads(threads as Parameters<typeof loadThreads>[0])
    },
    [loadThreads]
  )

  return { sendMessage, abort, approveTool, rejectTool, deleteThread }
}
