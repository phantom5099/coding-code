import { useState } from 'react'
import type { Item } from '@shared/types'
import CodeBlock from './CodeBlock'
import ToolCallCard from './ToolCallCard'

interface MessageItemProps {
  item: Item
  streamingContent?: string
  threadId: string
  onApprove: (threadId: string, callId: string) => void
  onReject: (threadId: string, callId: string) => void
}

function parseMarkdown(text: string): React.ReactNode {
  const blocks: React.ReactNode[] = []
  let remaining = text
  let key = 0

  while (remaining.length > 0) {
    const codeMatch = remaining.match(/```(\w*)\n?([\s\S]*?)```/)
    if (codeMatch && codeMatch.index !== undefined) {
      if (codeMatch.index > 0) {
        blocks.push(<span key={key++} className="whitespace-pre-wrap">{remaining.slice(0, codeMatch.index)}</span>)
      }
      blocks.push(<CodeBlock key={key++} code={codeMatch[2] ?? ''} language={codeMatch[1] || undefined} />)
      remaining = remaining.slice(codeMatch.index + codeMatch[0].length)
    } else {
      blocks.push(<span key={key++} className="whitespace-pre-wrap">{remaining}</span>)
      break
    }
  }

  return <>{blocks}</>
}

export default function MessageItem({ item, streamingContent, threadId, onApprove, onReject }: MessageItemProps) {
  const [reasoningOpen, setReasoningOpen] = useState(false)

  if (item.type === 'message') {
    const content = (item.partial && streamingContent) ? streamingContent : item.content
    const isUser = item.role === 'user'

    return (
      <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
        {isUser ? (
          <div className="max-w-[75%] px-3 py-2 rounded-2xl rounded-br-sm bg-[#0e639c] text-white text-sm leading-relaxed whitespace-pre-wrap break-words">
            {content}
          </div>
        ) : (
          <div className="max-w-[85%] text-sm text-[#d4d4d4] leading-relaxed">
            {parseMarkdown(content)}
            {item.partial && <span className="inline-block w-1.5 h-4 bg-[#569cd6] animate-pulse ml-0.5 align-middle" />}
          </div>
        )}
      </div>
    )
  }

  if (item.type === 'reasoning') {
    return (
      <div className="mb-2">
        <button
          onClick={() => setReasoningOpen((v) => !v)}
          className="flex items-center gap-1 text-xs text-[#666] hover:text-[#888] transition-colors"
        >
          <span className={`transition-transform ${reasoningOpen ? 'rotate-90' : ''}`}>▶</span>
          思考过程
        </button>
        {reasoningOpen && (
          <div className="mt-1 pl-3 border-l border-[#3c3c3c] text-xs text-[#888] whitespace-pre-wrap leading-relaxed">
            {item.content}
          </div>
        )}
      </div>
    )
  }

  if (item.type === 'tool_call') {
    return (
      <ToolCallCard
        item={item}
        threadId={threadId}
        onApprove={onApprove}
        onReject={onReject}
      />
    )
  }

  if (item.type === 'tool_result') {
    const isError = item.exitCode !== undefined && item.exitCode !== 0
    return (
      <div className="mb-2">
        <div className={`text-xs mb-1 ${isError ? 'text-[#f44747]' : 'text-[#4ec9b0]'}`}>
          {isError ? `✗ 退出码 ${item.exitCode}` : '✓ 执行结果'}
        </div>
        <CodeBlock code={item.output.slice(0, 4000)} />
      </div>
    )
  }

  if (item.type === 'error') {
    return (
      <div className="mb-2 px-3 py-2 rounded bg-[#3d1515] border border-[#f44747] text-[#f44747] text-sm">
        ✗ {item.message}
      </div>
    )
  }

  return null
}
