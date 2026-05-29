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
  const {
    approveTool, rejectTool,
    loadCheckpointDiff, revertFile, revertFiles, revertAgentFiles, revertAllFiles,
    previewRollback, rollbackCode, rollbackCtx, rollbackBoth,
    undoCodeRollback, forkThread, initRollbackState,
    revertedFilesByTurnId,
  } = useAgent()
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const wasAtBottomRef = useRef(true)

  // Rollback UI state
  const [latestDiff, setLatestDiff] = useState<any>(null)
  const [showRollbackPanel, setShowRollbackPanel] = useState<{ turnId: string; preview: any } | null>(null)
  const [loadingDiff, setLoadingDiff] = useState(false)

  // Initialize rollback state on mount
  useEffect(() => {
    initRollbackState(threadId)
  }, [threadId, initRollbackState])

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

  // Get completed turn IDs and the latest one
  const completedTurns = thread ? thread.turns.filter((t) => t.status === 'completed') : []
  const latestCompletedTurnId = completedTurns.length > 0 ? completedTurns[completedTurns.length - 1]?.id : null
  const revertedKey = latestCompletedTurnId ? `${threadId}:${latestCompletedTurnId}` : ''
  const revertedFiles = revertedFilesByTurnId[revertedKey] ?? []
  const isScopeReverted = revertedFiles.includes('__scope_reverted__')

  const handleDiffClick = useCallback(async () => {
    setLoadingDiff(true)
    try {
      const diff = await loadCheckpointDiff(threadId)
      setLatestDiff(diff)
    } finally {
      setLoadingDiff(false)
    }
  }, [threadId, loadCheckpointDiff])

  const handleRevertFile = useCallback(async (file: string) => {
    if (revertedFiles.includes(file)) {
      // Undo revert for this file
      await undoCodeRollback(threadId, false, [file])
    } else {
      await revertFile(threadId, file)
    }
    // Refresh diff
    try { const diff = await loadCheckpointDiff(threadId); setLatestDiff(diff) } catch {}
  }, [threadId, revertedFiles, revertFile, undoCodeRollback, loadCheckpointDiff])

  const handleRevertAgent = useCallback(async () => {
    if (isScopeReverted) {
      await undoCodeRollback(threadId, false)
    } else {
      await revertAgentFiles(threadId)
    }
    try { const diff = await loadCheckpointDiff(threadId); setLatestDiff(diff) } catch {}
  }, [threadId, isScopeReverted, revertAgentFiles, undoCodeRollback, loadCheckpointDiff])

  const handleRevertAll = useCallback(async () => {
    if (isScopeReverted) {
      await undoCodeRollback(threadId, false)
    } else {
      await revertAllFiles(threadId)
    }
    try { const diff = await loadCheckpointDiff(threadId); setLatestDiff(diff) } catch {}
  }, [threadId, isScopeReverted, revertAllFiles, undoCodeRollback, loadCheckpointDiff])

  const handleHistoryRollback = useCallback(async (throughTurnId: string) => {
    const turnNum = parseInt(throughTurnId, 10)
    const preview = await previewRollback(threadId, turnNum)
    setShowRollbackPanel({ turnId: throughTurnId, preview })
  }, [threadId, previewRollback])

  const handleRollbackCodeOnly = useCallback(async () => {
    if (!showRollbackPanel) return
    await rollbackCode(threadId, parseInt(showRollbackPanel.turnId, 10))
    setShowRollbackPanel(null)
  }, [threadId, showRollbackPanel, rollbackCode])

  const handleRollbackContext = useCallback(async () => {
    if (!showRollbackPanel) return
    await rollbackCtx(threadId, parseInt(showRollbackPanel.turnId, 10))
    setShowRollbackPanel(null)
  }, [threadId, showRollbackPanel, rollbackCtx])

  const handleRollbackBoth = useCallback(async () => {
    if (!showRollbackPanel) return
    await rollbackBoth(threadId, parseInt(showRollbackPanel.turnId, 10))
    setShowRollbackPanel(null)
  }, [threadId, showRollbackPanel, rollbackBoth])

  const handleFork = useCallback(async (turnId: string) => {
    // Find the last event UUID in this turn
    const turn = thread?.turns.find((t) => t.id === turnId)
    if (!turn) return
    const lastItem = turn.items[turn.items.length - 1]
    if (!lastItem) return
    await forkThread(threadId, lastItem.id)
  }, [threadId, thread, forkThread])

  // Group items by turn for rendering with turn headers
  const turns = thread?.turns ?? []

  if (!thread || allItems.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#444] text-[15px]">
        发送消息开始对话
      </div>
    )
  }

  const renderItem = (index: number) => {
    const entry = allItems[index]
    if (!entry) return null
    const { item } = entry
    return (
      <div className="px-6 py-0.5">
        <MessageItem
          key={item.id}
          item={item}
          threadId={threadId}
          onApprove={approveTool}
          onReject={rejectTool}
          callIdToToolName={callIdToToolName}
        />
      </div>
    )
  }

  const content = (
    <>
      {/* Latest turn diff panel */}
      {latestCompletedTurnId && (
        <div className="px-6 py-3 border-t border-[#333] mx-2 mb-2">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[13px] text-[#ccc] font-medium">本轮代码变更</span>
            <button
              onClick={handleDiffClick}
              disabled={loadingDiff}
              className="text-[12px] px-2 py-0.5 rounded bg-[#333] text-[#aaa] hover:bg-[#444] disabled:opacity-50"
            >
              {loadingDiff ? '加载中...' : '查看变更'}
            </button>
          </div>

          {latestDiff && latestDiff.files && (
            <div>
              {(() => {
                const agentCount = latestDiff.files.filter((f: any) => f.source === 'agent').length
                const unknownCount = latestDiff.files.filter((f: any) => f.source === 'unknown').length
                return (
                  <div className="text-[12px] text-[#888] mb-2">
                    Agent 修改：{agentCount} 个文件，来源不明：{unknownCount} 个文件
                  </div>
                )
              })()}

              <div className="space-y-1 max-h-[200px] overflow-y-auto mb-2">
                {latestDiff.files.map((f: any) => (
                  <div key={f.path} className="flex items-center justify-between text-[12px] py-1 px-2 rounded bg-[#1a1a1a]">
                    <span className="text-[#ccc] truncate flex-1">
                      {f.path.split('/').pop() || f.path}
                      <span className="text-[#666] ml-1">({f.source === 'agent' ? 'Agent' : '未知'})</span>
                    </span>
                    <button
                      onClick={() => handleRevertFile(f.path)}
                      className={`text-[11px] px-2 py-0.5 rounded ml-2 ${
                        revertedFiles.includes(f.path)
                          ? 'bg-[#4a3] text-white hover:bg-[#5b4]'
                          : 'bg-[#444] text-[#aaa] hover:bg-[#555]'
                      }`}
                    >
                      {revertedFiles.includes(f.path) ? '撤销回退此文件' : '回退此文件'}
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleRevertAgent}
                  className={`text-[12px] px-3 py-1 rounded ${
                    isScopeReverted
                      ? 'bg-[#4a3] text-white hover:bg-[#5b4]'
                      : 'bg-[#555] text-[#ccc] hover:bg-[#666]'
                  }`}
                >
                  {isScopeReverted ? '撤销回退 Agent 修改' : '只回退 Agent 修改'}
                </button>
                <button
                  onClick={handleRevertAll}
                  className={`text-[12px] px-3 py-1 rounded ${
                    isScopeReverted
                      ? 'bg-[#4a3] text-white hover:bg-[#5b4]'
                      : 'bg-[#c44] text-white hover:bg-[#d55]'
                  }`}
                >
                  {isScopeReverted ? '撤销回退本轮全部修改' : '回退本轮全部修改'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Turn headers with rollback options */}
      {turns.map((turn, idx) => (
        <div key={turn.id}>
          {idx > 0 && turn.status === 'completed' && (
            <div className="flex items-center gap-2 px-6 py-1">
              <span className="text-[11px] text-[#555]">Turn {turn.id}</span>
              <button
                onClick={() => handleHistoryRollback(turn.id)}
                className="text-[11px] px-2 py-0.5 rounded bg-[#2a2a2a] text-[#888] hover:bg-[#333] hover:text-[#ccc]"
              >
                回退到这里
              </button>
              <button
                onClick={() => handleFork(turn.id)}
                className="text-[11px] px-2 py-0.5 rounded bg-[#2a2a2a] text-[#888] hover:bg-[#333] hover:text-[#ccc]"
              >
                Fork from here
              </button>
            </div>
          )}
        </div>
      ))}

      {/* Rollback confirmation panel */}
      {showRollbackPanel && (
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
                onClick={handleRollbackContext}
                className="text-[12px] px-3 py-1.5 rounded bg-[#555] text-[#ccc] hover:bg-[#666]"
              >
                只回退上下文
              </button>
              <button
                onClick={handleRollbackCodeOnly}
                className="text-[12px] px-3 py-1.5 rounded bg-[#555] text-[#ccc] hover:bg-[#666]"
              >
                只回退代码
              </button>
              <button
                onClick={handleRollbackBoth}
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
      )}
    </>
  )

  if (isLargeList) {
    return (
      <div className="flex-1 flex flex-col">
        <Virtuoso
          ref={virtuosoRef}
          className="flex-1 select-text"
          totalCount={totalCount}
          itemContent={renderItem}
          followOutput={(isAtBottom) => isAtBottom ? 'smooth' : false}
          style={{ flex: 1 }}
        />
        {content}
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto select-text">
        <div className="pt-8 pb-4 max-w-[820px] mx-auto">
          {allItems.map(({ item }) => {
            return (
              <div key={item.id} className="px-6 py-0.5">
                <MessageItem
                  item={item}
                  threadId={threadId}
                  onApprove={approveTool}
                  onReject={rejectTool}
                  callIdToToolName={callIdToToolName}
                />
              </div>
            )
          })}
        </div>
      </div>
      {content}
    </div>
  )
}
