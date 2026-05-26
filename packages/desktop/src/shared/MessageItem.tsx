import { useState } from 'react'
import type { Item } from '@shared/types'
import CodeBlock from './CodeBlock'
import ToolCallCard from './ToolCallCard'

const TOOL_ICONS: Record<string, string> = {
  shell: '⚡',
  file_read: '📄',
  apply_patch: '✏️',
  list_dir: '📁',
  search: '🔍',
}

interface MessageItemProps {
  item: Item
  streamingContent?: string
  threadId: string
  onApprove: (threadId: string, callId: string) => void
  onReject: (threadId: string, callId: string) => void
  callIdToToolName?: Record<string, string>
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

export default function MessageItem({ item, streamingContent, threadId, onApprove, onReject, callIdToToolName }: MessageItemProps) {
  const [reasoningOpen, setReasoningOpen] = useState(false)
  const [resultOpen, setResultOpen] = useState(false)

  if (item.type === 'message') {
    const content = (item.partial && streamingContent) ? streamingContent : item.content
    const isUser = item.role === 'user'

    if (isUser) {
      return (
        <div className="flex justify-end mb-4">
          <div className="max-w-[78%] px-4 py-3 rounded-2xl rounded-br-sm bg-[#2a2a2a] text-[#e8e8e8] text-[15px] leading-relaxed whitespace-pre-wrap break-words">
            {content}
          </div>
        </div>
      )
    }

    return (
      <div className="flex justify-start mb-4">
        <div className="max-w-[88%] text-[15px] text-[#d4d4d4] leading-relaxed">
          {parseMarkdown(content)}
          {item.partial && <span className="inline-block w-1.5 h-[1.1em] bg-[#569cd6] animate-pulse ml-0.5 align-middle" />}
        </div>
      </div>
    )
  }

  if (item.type === 'reasoning') {
    return (
      <div className="mb-3">
        <button
          type="button"
          onClick={() => setReasoningOpen((v) => !v)}
          className="flex items-center gap-1.5 text-[13px] text-[#555] hover:text-[#888] transition-colors"
        >
          <span className={`transition-transform text-[10px] ${reasoningOpen ? 'rotate-90' : ''}`}>▶</span>
          思考过程
        </button>
        {reasoningOpen && (
          <div className="mt-2 pl-3 border-l-2 border-[#2a2a2a] text-[13px] text-[#777] whitespace-pre-wrap leading-relaxed">
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
    const toolName = item.name ?? callIdToToolName?.[item.callId]
    const icon = toolName ? (TOOL_ICONS[toolName] ?? '🔧') : null
    return (
      <div className="mb-3">
        <button
          type="button"
          onClick={() => setResultOpen((v) => !v)}
          className="flex items-center gap-1.5 text-[13px] hover:opacity-80 transition-opacity"
        >
          <span className={`transition-transform text-[10px] text-[#555] ${resultOpen ? 'rotate-90' : ''}`}>▶</span>
          {icon && <span>{icon}</span>}
          {toolName && <span className="font-mono text-[#dcdcaa]">{toolName}</span>}
          <span className={isError ? 'text-[#f44747]' : 'text-[#4ec9b0]'}>
            {isError ? `✗ 退出码 ${item.exitCode}` : '✓ 执行结果'}
          </span>
        </button>
        {resultOpen && (
          <div className="mt-1.5">
            <CodeBlock code={item.output.slice(0, 4000)} />
          </div>
        )}
      </div>
    )
  }

  if (item.type === 'error') {
    return (
      <div className="mb-3 px-4 py-3 rounded-lg bg-[#2a1515] border border-[#5a2020] text-[#f47777] text-[14px] leading-relaxed">
        {item.message}
      </div>
    )
  }

  return null
}
