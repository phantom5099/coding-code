import { useState } from 'react'
import CodeBlock from './CodeBlock'

interface ToolCallItem {
  id: string
  type: 'tool_call'
  name: string
  args: object
  status: 'pending' | 'approved' | 'rejected' | 'running'
}

interface ToolCallCardProps {
  item: ToolCallItem
  threadId: string
  onApprove: (threadId: string, callId: string) => void
  onReject: (threadId: string, callId: string) => void
}

const TOOL_ICONS: Record<string, string> = {
  shell: '⚡',
  file_read: '📄',
  apply_patch: '✏️',
  list_dir: '📁',
  search: '🔍',
}

export default function ToolCallCard({ item, threadId, onApprove, onReject }: ToolCallCardProps) {
  const [argsOpen, setArgsOpen] = useState(false)
  const icon = TOOL_ICONS[item.name] ?? '🔧'
  const argsJson = JSON.stringify(item.args, null, 2)
  const isRejected = item.status === 'rejected'
  const hasArgs = argsJson !== '{}'

  return (
    <div className={`my-2 rounded border ${isRejected ? 'border-[#444] opacity-50' : 'border-[#3c3c3c]'} bg-[#252526] overflow-hidden`}>
      <div className="flex items-center gap-2 px-3 py-2 bg-[#2d2d2d]">
        {hasArgs ? (
          <button
            type="button"
            onClick={() => setArgsOpen((v) => !v)}
            className="flex items-center gap-2 min-w-0 hover:opacity-80 transition-opacity"
          >
            <span className={`transition-transform text-[10px] text-[#555] ${argsOpen ? 'rotate-90' : ''}`}>▶</span>
            <span>{icon}</span>
            <span className={`font-mono text-sm font-medium ${isRejected ? 'line-through text-[#666]' : 'text-[#dcdcaa]'}`}>
              {item.name}
            </span>
          </button>
        ) : (
          <>
            <span>{icon}</span>
            <span className={`font-mono text-sm font-medium ${isRejected ? 'line-through text-[#666]' : 'text-[#dcdcaa]'}`}>
              {item.name}
            </span>
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          {item.status === 'pending' && (
            <>
              <button
                type="button"
                onClick={() => onApprove(threadId, item.id)}
                className="px-2 py-0.5 text-xs bg-[#0e639c] hover:bg-[#1177bb] text-white rounded transition-colors"
              >
                批准
              </button>
              <button
                type="button"
                onClick={() => onReject(threadId, item.id)}
                className="px-2 py-0.5 text-xs bg-[#3c3c3c] hover:bg-[#4c4c4c] text-[#ccc] rounded transition-colors"
              >
                拒绝
              </button>
            </>
          )}
          {item.status === 'running' && (
            <span className="text-xs text-[#569cd6] flex items-center gap-1">
              <span className="inline-block animate-spin">⟳</span> 执行中
            </span>
          )}
          {item.status === 'approved' && (
            <span className="text-xs text-[#4ec9b0]">✓ 已完成</span>
          )}
          {item.status === 'rejected' && (
            <span className="text-xs text-[#666]">✗ 已拒绝</span>
          )}
        </div>
      </div>
      {hasArgs && argsOpen && (
        <div className="px-3 pb-2 pt-1">
          <CodeBlock code={argsJson} language="json" />
        </div>
      )}
    </div>
  )
}
