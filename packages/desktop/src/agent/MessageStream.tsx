import { useEffect, useRef } from 'react'
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
  const streamingContent = useGlobalStore((s) => s.agent.streamingContent)
  const { approveTool, rejectTool } = useAgent()
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const wasAtBottomRef = useRef(true)

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
    const streaming = item.type === 'message' && item.partial ? streamingContent[item.id] : undefined
    return (
      <div className="px-6 py-0.5">
        <MessageItem
          key={item.id}
          item={item}
          streamingContent={streaming}
          threadId={threadId}
          onApprove={approveTool}
          onReject={rejectTool}
          callIdToToolName={callIdToToolName}
        />
      </div>
    )
  }

  if (isLargeList) {
    return (
      <Virtuoso
        ref={virtuosoRef}
        className="flex-1 select-text"
        totalCount={totalCount}
        itemContent={renderItem}
        followOutput={(isAtBottom) => isAtBottom ? 'smooth' : false}
        style={{ flex: 1 }}
      />
    )
  }

  return (
    <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto select-text">
      <div className="pt-8 pb-4 max-w-[820px] mx-auto">
        {allItems.map(({ item }) => {
          const streaming = item.type === 'message' && item.partial ? streamingContent[item.id] : undefined
          return (
            <div key={item.id} className="px-6 py-0.5">
              <MessageItem
                item={item}
                streamingContent={streaming}
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
  )
}
