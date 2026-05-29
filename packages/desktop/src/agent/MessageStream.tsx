import { useEffect, useRef, useState, useCallback } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { useGlobalStore } from '../stores/global.store'
import MessageItem from '../shared/MessageItem'
import type { Item } from '@shared/types'
import { useAgent } from '../hooks/useAgent'

interface MessageStreamProps {
  threadId: string
}

export default function MessageStream({ threadId }: MessageStreamProps) {
  const thread = useGlobalStore((s) => s.agent.threads[threadId])
  const setCurrentThread = useGlobalStore((s) => s.setCurrentThread)
  const {
    approveTool, rejectTool,
    loadCheckpointDiff, revertFile, revertAgentFiles, revertAllFiles,
    previewRollback, rollbackCode, rollbackCtx, rollbackBoth,
    undoCodeRollback, forkThread,
    revertedFilesByTurnId,
  } = useAgent()
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const wasAtBottomRef = useRef(true)

  const checkpointDiffByTurnId = useGlobalStore((s) => s.rollback.checkpointDiffByTurnId)
  const turnCheckpointMapping = useGlobalStore((s) => s.rollback.turnCheckpointMapping)
  const markScopeRestored = useGlobalStore((s) => s.markScopeRestored)
  const markFileRestored = useGlobalStore((s) => s.markFileRestored)
  const setPendingInput = useGlobalStore((s) => s.setPendingInput)

  // Rollback modal state (only thing left in local state)
  const [showRollbackPanel, setShowRollbackPanel] = useState<{ turnId: string; preview: any } | null>(null)

  const allItems: Array<{ item: Item; turnId: string }> = []
  if (thread) {
    for (const turn of thread.turns) {
      for (const item of turn.items) {
        allItems.push({ item, turnId: turn.id })
      }
    }
  }

  const callIdToToolName: Record<string, string> = {}
  for (const { item } of allItems) {
    if (item.type === 'tool_call') {
      callIdToToolName[item.id] = item.name
    }
  }

  const totalCount = allItems.length
  const isLargeList = totalCount > 100
  const turns = thread?.turns ?? []

  const handleScroll = () => {
    const el = scrollContainerRef.current
    if (!el) return
    wasAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  useEffect(() => {
    if (totalCount === 0 || isLargeList) return
    if (!wasAtBottomRef.current) return
    const el = scrollContainerRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [totalCount, isLargeList])

  // Auto-load diff when a turn completes or errors
  const turnStatusKey = turns.map((t) => `${t.id}:${t.status}`).join(',')
  useEffect(() => {
    for (const turn of turns) {
      if (turn.status !== 'completed' && turn.status !== 'error') continue
      const ckKey = getCheckpointKey(turn.id)
      if (!ckKey || !checkpointDiffByTurnId[ckKey]) {
        handleLoadDiff(turn.id)
      }
    }
  }, [turnStatusKey])

  // ---- Helpers for per-turn diff data ----

  function getCheckpointKey(uiTurnId: string): string | null {
    const directKey = `${threadId}:${uiTurnId}`
    if (checkpointDiffByTurnId[directKey]) return directKey
    const mapping = turnCheckpointMapping[threadId]
    if (mapping) {
      for (const [cpId, mappedUiId] of Object.entries(mapping)) {
        if (mappedUiId === uiTurnId) return `${threadId}:${cpId}`
      }
    }
    // Try a partial match — walk all checkpointDiff keys for this thread
    for (const key of Object.keys(checkpointDiffByTurnId)) {
      if (!key.startsWith(`${threadId}:`)) continue
      const cpIntStr = key.slice(threadId.length + 1)
      if (turnCheckpointMapping[threadId]?.[Number(cpIntStr)] === uiTurnId) return key
    }
    return null
  }

  function getRevertedFiles(uiTurnId: string): string[] {
    return revertedFilesByTurnId[`${threadId}:${uiTurnId}`] ?? []
  }

  // ---- Handlers ----

  const handleLoadDiff = useCallback(async (uiTurnId: string) => {
    const diff = await loadCheckpointDiff(threadId)
    if (diff.turnId > 0) {
      const state = useGlobalStore.getState()
      const mapping = state.rollback.turnCheckpointMapping[threadId]
      if (mapping?.[diff.turnId] !== uiTurnId) {
        state.setTurnCheckpointMapping(threadId, diff.turnId, uiTurnId)
      }
    }
  }, [threadId, loadCheckpointDiff])

  const handleRevertFile = useCallback(async (uiTurnId: string, file: string, isReverted: boolean) => {
    if (isReverted) {
      await undoCodeRollback(threadId, uiTurnId, false, [file])
      markFileRestored(threadId, uiTurnId, file)
    } else {
      await revertFile(threadId, file)
    }
  }, [threadId, revertFile, undoCodeRollback, markFileRestored])

  const handleRevertScope = useCallback(async (uiTurnId: string, scope: 'agent' | 'all', isReverted: boolean) => {
    if (isReverted) {
      await undoCodeRollback(threadId, uiTurnId, false)
      markScopeRestored(threadId, uiTurnId, scope)
    } else if (scope === 'agent') {
      await revertAgentFiles(threadId)
    } else {
      await revertAllFiles(threadId)
    }
  }, [threadId, revertAgentFiles, revertAllFiles, undoCodeRollback, markScopeRestored])

  // ---- Sub-component: TurnDiffPanel (Codex style, inline, per turn) ----

  function TurnDiffPanel({ uiTurnId, isInterrupted }: { uiTurnId: string; isInterrupted?: boolean }) {
    const ckKey = getCheckpointKey(uiTurnId)
    const diff = ckKey ? checkpointDiffByTurnId[ckKey] : null
    const revertedFiles = getRevertedFiles(uiTurnId)
    const isAgentReverted = revertedFiles.includes('__scope_agent_reverted__')
    const isAllReverted = revertedFiles.includes('__scope_all_reverted__')
    const [expandedFile, setExpandedFile] = useState<string | null>(null)

    if (!diff || !diff.files || diff.files.length === 0) {
      return null
    }

    const totalInsertions = diff.files.reduce((sum: number, f: any) => sum + (f.insertions ?? 0), 0)
    const totalDeletions = diff.files.reduce((sum: number, f: any) => sum + (f.deletions ?? 0), 0)

    return (
      <div className="mt-2 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded bg-[#2a2a2a] flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 1v14M1 8h14" stroke="#888" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <span className="text-[13px] text-[#ccc]">
                已编辑 {diff.files.length} 个文件
              </span>
              {isInterrupted && (
                <span className="ml-2 text-[11px] text-[#c88]">（对话中断）</span>
              )}
              <div className="flex items-center gap-2 mt-0.5">
                {totalInsertions > 0 && <span className="text-[12px] text-[#4a4]">+{totalInsertions}</span>}
                {totalDeletions > 0 && <span className="text-[12px] text-[#c44]">-{totalDeletions}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleRevertScope(uiTurnId, 'all', isAllReverted)}
              className={`text-[12px] px-3 py-1 rounded ${
                isAllReverted
                  ? 'bg-[#4a3] text-white hover:bg-[#5b4]'
                  : 'bg-[#333] text-[#aaa] hover:bg-[#444] border border-[#444]'
              }`}
            >
              {isAllReverted ? '撤销回退本轮全部修改' : '回退本轮全部修改'}
            </button>
            <button
              onClick={() => handleRevertScope(uiTurnId, 'agent', isAgentReverted)}
              className={`text-[12px] px-3 py-1 rounded ${
                isAgentReverted
                  ? 'bg-[#4a3] text-white hover:bg-[#5b4]'
                  : 'bg-[#333] text-[#aaa] hover:bg-[#444] border border-[#444]'
              }`}
            >
              {isAgentReverted ? '撤销回退 Agent 修改' : '只回退 Agent 修改'}
            </button>
          </div>
        </div>

        {/* File list */}
        <div className="border-t border-[#2a2a2a]">
          {diff.files.map((f: any) => {
            const isExpanded = expandedFile === f.path
            const isFileIndividuallyReverted = revertedFiles.includes(f.path)
            const isFileScopeReverted = isAllReverted || (isAgentReverted && f.source === 'agent')
            const isReverted = isFileIndividuallyReverted || isFileScopeReverted
            return (
              <div key={f.path}>
                <div
                  className="flex items-center justify-between px-4 py-2 hover:bg-[#222] cursor-pointer"
                  onClick={() => setExpandedFile(isExpanded ? null : f.path)}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-[12px] text-[#ccc] truncate">{f.path.replace(/\\/g, '/')}</span>
                    <span className="text-[10px] text-[#666] shrink-0">
                      {f.source === 'agent' ? 'Agent' : '未知'}
                    </span>
                    {isReverted && <span className="text-[10px] text-[#c88] shrink-0">已回退</span>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-3">
                    <div className="flex items-center gap-1.5 text-[12px]">
                      {f.insertions > 0 && <span className="text-[#4a4]">+{f.insertions}</span>}
                      {f.deletions > 0 && <span className="text-[#c44]">-{f.deletions}</span>}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRevertFile(uiTurnId, f.path, isReverted)
                      }}
                      className={`text-[11px] px-2 py-0.5 rounded ${
                        isReverted
                          ? 'bg-[#4a3] text-white hover:bg-[#5b4]'
                          : 'bg-[#333] text-[#888] hover:bg-[#444]'
                      }`}
                    >
                      {isReverted ? '撤销' : '回退'}
                    </button>
                    <svg
                      width="12" height="12" viewBox="0 0 12 12" fill="none"
                      className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    >
                      <path d="M3 4.5L6 7.5L9 4.5" stroke="#666" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                </div>
                {isExpanded && (
                  <div className="px-4 pb-2">
                    <pre className="text-[11px] bg-[#111] p-3 rounded text-[#aaa] max-h-[200px] overflow-auto whitespace-pre-wrap">
                      {f.diff || '无差异'}
                    </pre>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ---- Empty state ----

  if (!thread || allItems.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#444] text-[15px]">
        发送消息开始对话
      </div>
    )
  }

  // ---- Pre-compute turn-end indices and rollback callbacks ----

  const turnEndIndices = new Set<number>()
  const turnRollbackCallbacks = new Map<string, {
    onRollbackHere?: () => void
    onForkFromHere?: () => void
  }>()
  let idx = 0
  for (const turn of turns) {
    idx += turn.items.length - 1
    if (turn.status === 'completed' || turn.status === 'error') {
      turnEndIndices.add(idx)
      const turnNum = parseInt(turn.id, 10)
      turnRollbackCallbacks.set(turn.id, {
        onRollbackHere: !isNaN(turnNum) ? () => {
          previewRollback(threadId, turnNum).then((preview: any) => {
            setShowRollbackPanel({ turnId: String(turnNum), preview })
          })
        } : undefined,
        onForkFromHere: async () => {
          const lastItem = turn.items[turn.items.length - 1]
          if (lastItem) {
            // Get the user message from this turn to refill input after fork
            const userMsg = turn.items.find((i) => i.type === 'message' && (i as any).role === 'user')
            const userContent = userMsg && 'content' in userMsg ? (userMsg as any).content : ''
            const newSessionId = await forkThread(threadId, lastItem.id)
            if (newSessionId) {
              setCurrentThread(newSessionId)
              if (userContent) setPendingInput(userContent)
            }
          }
        },
      })
    }
    idx++
  }

  // ---- Render single item (with optional turn-end diff panel) ----

  function renderItem(index: number) {
    const entry = allItems[index]
    if (!entry) return null
    const isLastInTurn = turnEndIndices.has(index)
    const cbs = turnRollbackCallbacks.get(entry.turnId)
    const isUserMsg = entry.item.type === 'message' && entry.item.role === 'user'
    const turn = turns.find((t) => t.id === entry.turnId)
    const isInterrupted = turn?.status === 'error'

    return (
      <div>
        <div className="px-6 py-0.5">
          <MessageItem
            item={entry.item}
            threadId={threadId}
            onApprove={approveTool}
            onReject={rejectTool}
            callIdToToolName={callIdToToolName}
            onRollbackHere={isUserMsg && cbs ? cbs.onRollbackHere : undefined}
            onForkFromHere={isUserMsg && cbs ? cbs.onForkFromHere : undefined}
          />
        </div>
        {isLastInTurn && (
          <div className="px-6 pb-2">
            <TurnDiffPanel uiTurnId={entry.turnId} isInterrupted={isInterrupted} />
          </div>
        )}
      </div>
    )
  }

  const rollbackModal = showRollbackPanel && (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#1e1e1e] border border-[#444] rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
        <h3 className="text-[15px] text-[#ccc] mb-4">
          将回退到 Turn {showRollbackPanel.turnId}
        </h3>
        {showRollbackPanel.preview && (
          <div className="mb-4">
            <div className="text-[12px] text-[#888] mb-2">回退前 / 回退后差异：</div>
            <pre className="text-[11px] bg-[#111] p-3 rounded text-[#aaa] max-h-[300px] overflow-auto whitespace-pre-wrap">
              {showRollbackPanel.preview.diff || '无差异'}
            </pre>
          </div>
        )}
        <div className="flex gap-2">
          <button
            onClick={async () => {
              if (!showRollbackPanel) return
              await rollbackCtx(threadId, parseInt(showRollbackPanel.turnId, 10))
              setShowRollbackPanel(null)
            }}
            className="text-[12px] px-3 py-1.5 rounded bg-[#555] text-[#ccc] hover:bg-[#666]"
          >
            只回退上下文
          </button>
          <button
            onClick={async () => {
              if (!showRollbackPanel) return
              await rollbackBoth(threadId, parseInt(showRollbackPanel.turnId, 10))
              setShowRollbackPanel(null)
            }}
            className="text-[12px] px-3 py-1.5 rounded bg-[#c44] text-white hover:bg-[#d55]"
          >
            上下文和代码都回退
          </button>
          <button
            onClick={() => setShowRollbackPanel(null)}
            className="text-[12px] px-3 py-1.5 rounded bg-[#333] text-[#888] hover:bg-[#444]"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )

  // ---- Virtuoso path (many items) ----

  if (isLargeList) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <Virtuoso
          ref={virtuosoRef}
          className="flex-1 select-text"
          totalCount={totalCount}
          itemContent={renderItem}
          followOutput={(isAtBottom: boolean) => isAtBottom ? 'smooth' : false}
          style={{ flex: 1 }}
        />
        {rollbackModal}
      </div>
    )
  }

  // ---- Non-Virtuoso path (few items) ----

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto select-text">
        <div className="pt-8 pb-4 max-w-[820px] mx-auto">
          {allItems.map((_, i) => {
            const entry = allItems[i]
            return <div key={entry?.item.id ?? i}>{renderItem(i)}</div>
          })}
        </div>
      </div>
      {rollbackModal}
    </div>
  )
}
