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

  const allItems: Array<{ item: Item; turnId: string }> = []
  if (thread) {
    for (const turn of thread.turns) {
      for (const item of turn.items) {
        allItems.push({ item, turnId: turn.id })
      }
    }
  }

  const totalCount = allItems.length
  const isLargeList = totalCount > 100

  useEffect(() => {
    if (totalCount === 0) return
    setTimeout(() => {
      virtuosoRef.current?.scrollToIndex({ index: totalCount - 1, behavior: 'smooth' })
    }, 50)
  }, [totalCount])

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
        followOutput="smooth"
        style={{ flex: 1 }}
      />
    )
  }

  return (
    <div className="flex-1 overflow-y-auto select-text">
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
              />
            </div>
          )
        })}
      </div>
      <div ref={(el) => { if (el) el.scrollIntoView({ behavior: 'smooth' }) }} />
    </div>
  )
}
