import { useEffect, useCallback } from 'react'
import { useGlobalStore } from '../stores/global.store'
import type { ModelEntry } from '../stores/global.store'
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
  const updateToolCallStatus = useGlobalStore((s) => s.updateToolCallStatus)
  const workspace = useGlobalStore((s) => s.workspace)
  const currentThreadId = useGlobalStore((s) => s.agent.currentThreadId)

  // Load persisted threads, settings, models, and projects on mount
  useEffect(() => {
    window.electronAPI?.getThreads?.().then((threads) => {
      loadThreads(threads as Parameters<typeof loadThreads>[0])
    })
    window.electronAPI?.getModels?.().then((models) => {
      setModels(models as ModelEntry[])
    })
    window.electronAPI?.getSettings?.().then((settings) => {
      if (settings.activeModel) setModel(settings.activeModel)
      if (settings.approvalPolicy) setApprovalPolicy(settings.approvalPolicy as 'suggest' | 'auto-edit' | 'full-auto')
    })
    window.electronAPI?.getProjects?.().then(async (projects) => {
      if (projects && projects.length > 0) {
        setProjects(projects as Project[])
        const settings = await window.electronAPI?.getSettings?.()
        const savedId = settings?.currentProjectId
        const targetId = savedId && projects.some((p: Project) => p.id === savedId) ? savedId : (projects[0] as Project).id
        switchProject(targetId)
      } else {
        // First launch: auto-create project from workspace
        const settings = await window.electronAPI?.getSettings?.()
        const ws = settings?.workspace
        if (ws?.rootPath) {
          const project = await window.electronAPI?.addProject?.(ws.rootPath)
          if (project) {
            addProject(project as Project)
            switchProject(project.id)
            window.electronAPI?.setCurrentProjectId?.(project.id)
          }
        }
      }
    })
  }, [loadThreads, setModel, setModels, setApprovalPolicy, setProjects, switchProject, addProject])

  // Load history from disk when switching to a thread that has no turns in memory
  useEffect(() => {
    if (!currentThreadId) return
    const thread = useGlobalStore.getState().agent.threads[currentThreadId]
    if (!thread || thread.turns.length > 0) return
    window.electronAPI?.loadHistory?.(currentThreadId).then((turns) => {
      if (turns && turns.length > 0) {
        setThreadTurns(currentThreadId, turns as Turn[])
      }
    })
  }, [currentThreadId, setThreadTurns])

  // Subscribe to agent events
  useEffect(() => {
    const offChunk = window.electronAPI?.onAgentChunk?.((payload) => {
      applyChunk(payload.threadId, payload.turnId, payload.chunk)
    })
    const offDone = window.electronAPI?.onAgentDone?.((payload) => {
      completeTurn(payload.threadId, payload.turnId, payload.error ? 'error' : 'completed')
      window.electronAPI?.getThreads?.().then((threads) => {
        loadThreads(threads as Parameters<typeof loadThreads>[0])
      })
    })
    return () => {
      offChunk?.()
      offDone?.()
    }
  }, [applyChunk, completeTurn, loadThreads])

  const sendMessage = useCallback(
    async (threadId: string, content: string, cwd?: string) => {
      const turnId = randomId()
      const userItem: Item = { id: randomId(), type: 'message', role: 'user', content }
      const turn: Turn = { id: turnId, items: [userItem], status: 'running' }
      const effectiveCwd = cwd || workspace.rootPath || undefined
      startTurn(threadId, turn, { cwd: effectiveCwd, title: content.slice(0, 60) })
      setCurrentThread(threadId)
      setContextUsage(null)
      const runCwd = await window.electronAPI?.sendMessage?.(threadId, turnId, content, effectiveCwd)
      const normalizedRunCwd = runCwd ? normalizeCwd(runCwd) : undefined
      if (normalizedRunCwd && normalizedRunCwd !== effectiveCwd) {
        setThreadCwd(threadId, normalizedRunCwd)
      }
    },
    [startTurn, setCurrentThread, setContextUsage, setThreadCwd, workspace.rootPath]
  )

  const abort = useCallback((threadId: string) => {
    window.electronAPI?.abortAgent?.(threadId)
  }, [])

  const approveTool = useCallback((threadId: string, callId: string) => {
    updateToolCallStatus(threadId, callId, 'running')
    window.electronAPI?.approveTool?.(threadId, callId)
  }, [updateToolCallStatus])

  const rejectTool = useCallback((threadId: string, callId: string) => {
    updateToolCallStatus(threadId, callId, 'rejected')
    window.electronAPI?.rejectTool?.(threadId, callId)
  }, [updateToolCallStatus])

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
