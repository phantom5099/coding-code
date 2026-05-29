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
    } else {
      await revertFile(threadId, file)
    }
  }, [threadId, revertFile, undoCodeRollback])

  const handleRevertScope = useCallback(async (uiTurnId: string, scope: 'agent' | 'all', isReverted: boolean) => {
    if (isReverted) {
      await undoCodeRollback(threadId, uiTurnId, false)
    } else if (scope === 'agent') {
      await revertAgentFiles(threadId)
    } else {
      await revertAllFiles(threadId)
    }
  }, [threadId, revertAgentFiles, revertAllFiles, undoCodeRollback])

  // ---- Sub-component: TurnDiffPanel (inline, per turn) ----

  function TurnDiffPanel({ uiTurnId }: { uiTurnId: string }) {
    const ckKey = getCheckpointKey(uiTurnId)
    const diff = ckKey ? checkpointDiffByTurnId[ckKey] : null
    const revertedFiles = getRevertedFiles(uiTurnId)
    const isScopeReverted = revertedFiles.includes('__scope_reverted__')

    if (!diff || !diff.files || diff.files.length === 0) {
      return (
        <div className="mt-2 px-2">
          <button
            onClick={() => handleLoadDiff(uiTurnId)}
            className="text-[11px] px-2 py-0.5 rounded bg-[#333] text-[#888] hover:bg-[#444]"
          >
            查看变更
          </button>
        </div>
      )
    }

    const agentCount = diff.files.filter((f: any) => f.source === 'agent').length
    const unknownCount = diff.files.filter((f: any) => f.source === 'unknown').length

    return (
      <div className="mt-2 px-2 py-2 border-t border-[#2a2a2a]">
        <div className="text-[12px] text-[#888] mb-2">
          Agent 修改：{agentCount} 个文件，来源不明：{unknownCount} 个文件
        </div>
        <div className="space-y-1 max-h-[180px] overflow-y-auto mb-2">
          {diff.files.map((f: any) => (
            <div key={f.path} className="flex items-center justify-between text-[12px] py-1 px-2 rounded bg-[#1a1a1a]">
              <span className="text-[#ccc] truncate flex-1">
                {f.path.replace(/\\/g, '/').split('/').pop() || f.path}
                <span className="text-[#666] ml-1">({f.source === 'agent' ? 'Agent' : '未知'})</span>
              </span>
              <button
                onClick={() => handleRevertFile(uiTurnId, f.path, revertedFiles.includes(f.path))}
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
            onClick={() => handleRevertScope(uiTurnId, 'agent', isScopeReverted)}
            className={`text-[12px] px-3 py-1 rounded ${
              isScopeReverted
                ? 'bg-[#4a3] text-white hover:bg-[#5b4]'
                : 'bg-[#555] text-[#ccc] hover:bg-[#666]'
            }`}
          >
            {isScopeReverted ? '撤销回退 Agent 修改' : '只回退 Agent 修改'}
          </button>
          <button
            onClick={() => handleRevertScope(uiTurnId, 'all', isScopeReverted)}
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
    onRollbackContext?: () => void
    onForkFromHere?: () => void
  }>()
  let idx = 0
  for (const turn of turns) {
    idx += turn.items.length - 1
    if (turn.status === 'completed') {
      turnEndIndices.add(idx)
      const turnNum = parseInt(turn.id, 10)
      const hasNumericId = !isNaN(turnNum)
      turnRollbackCallbacks.set(turn.id, {
        onRollbackHere: hasNumericId ? () => {
          previewRollback(threadId, turnNum).then((preview: any) => {
            setShowRollbackPanel({ turnId: String(turnNum), preview })
          })
        } : undefined,
        onRollbackContext: hasNumericId ? () => { rollbackCtx(threadId, turnNum) } : undefined,
        onForkFromHere: () => {
          const lastItem = turn.items[turn.items.length - 1]
          if (lastItem) forkThread(threadId, lastItem.id)
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
            onRollbackContext={isUserMsg && cbs ? cbs.onRollbackContext : undefined}
            onForkFromHere={isUserMsg && cbs ? cbs.onForkFromHere : undefined}
          />
        </div>
        {isLastInTurn && (
          <div className="px-6 pb-2">
            <TurnDiffPanel uiTurnId={entry.turnId} />
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
              await rollbackCode(threadId, parseInt(showRollbackPanel.turnId, 10))
              setShowRollbackPanel(null)
            }}
            className="text-[12px] px-3 py-1.5 rounded bg-[#555] text-[#ccc] hover:bg-[#666]"
          >
            只回退代码
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
}
