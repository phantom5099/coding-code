import { useState, useRef, useCallback } from 'react'
import { useGlobalStore } from '../stores/global.store'
import { useAgent } from '../hooks/useAgent'
import MessageStream from './MessageStream'

// ─── InputBox ──────────────────────────────────────────────────────────────

interface InputBoxProps {
  centered?: boolean
  threadId: string
}

function InputBox({ centered, threadId }: InputBoxProps) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isStreaming = useGlobalStore((s) => s.agent.isStreaming)
  const approvalPolicy = useGlobalStore((s) => s.agent.approvalPolicy)
  const model = useGlobalStore((s) => s.agent.model)
  const workspace = useGlobalStore((s) => s.workspace)
  const setApprovalPolicy = useGlobalStore((s) => s.setApprovalPolicy)
  const { sendMessage, abort } = useAgent()

  const handleSend = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed || isStreaming) return
    setText('')
    sendMessage(threadId, trimmed, workspace.rootPath || undefined)
  }, [text, isStreaming, sendMessage, threadId, workspace.rootPath])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const handlePolicyChange = async (p: 'suggest' | 'auto-edit' | 'full-auto') => {
    setApprovalPolicy(p)
    await window.electronAPI?.setApprovalPolicy?.(p)
  }

  const POLICY_LABELS: Record<string, string> = { suggest: '自动审查', 'auto-edit': '自动编辑', 'full-auto': '全自动' }
  const POLICY_NEXT: Record<string, 'auto-edit' | 'full-auto' | 'suggest'> = {
    suggest: 'auto-edit', 'auto-edit': 'full-auto', 'full-auto': 'suggest',
  }

  return (
    <div className={`relative ${centered ? 'w-full max-w-[680px]' : 'px-4 pb-3 pt-2'}`}>
      <div className="rounded-xl border border-[#2d2d2d] bg-[#1a1a1a] hover:border-[#3c3c3c] focus-within:border-[#3a5a7a] transition-colors shadow-lg">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="可向 AI 询问任何事"
          disabled={isStreaming}
          rows={3}
          className="w-full bg-transparent px-4 pt-3 pb-1 text-sm text-[#d4d4d4] placeholder-[#3a3a3a] resize-none outline-none leading-relaxed disabled:opacity-50"
        />
        <div className="flex items-center gap-2 px-3 pb-3 pt-1">
          <button type="button"
            onClick={() => handlePolicyChange(POLICY_NEXT[approvalPolicy])}
            className="flex items-center gap-1 px-2 py-1 text-xs text-[#666] hover:text-[#aaa] hover:bg-[#2a2a2a] rounded-lg transition-colors">
            <span className="text-[#569cd6]">⊙</span>
            <span>{POLICY_LABELS[approvalPolicy] ?? '自动审查'}</span>
            <span className="text-[#3c3c3c]">▾</span>
          </button>

          <div className="ml-auto flex items-center gap-2">
            {model && (
              <button type="button"
                className="flex items-center gap-1 px-2 py-1 text-xs text-[#555] hover:text-[#aaa] hover:bg-[#2a2a2a] rounded-lg transition-colors font-mono">
                <span>{model.split('-').slice(-2).join(' ')}</span>
                <span className="text-[#3c3c3c]">▾</span>
              </button>
            )}
            {isStreaming ? (
              <button type="button" onClick={() => abort(threadId)}
                className="w-7 h-7 flex items-center justify-center bg-[#3a3a3a] hover:bg-[#4a4a4a] text-[#ccc] rounded-lg transition-colors text-sm">
                ■
              </button>
            ) : (
              <button type="button" onClick={handleSend} disabled={!text.trim()}
                className="w-7 h-7 flex items-center justify-center bg-[#ccc] disabled:bg-[#2a2a2a] disabled:text-[#444] text-[#111] rounded-lg transition-colors text-sm font-bold">
                ↑
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── AgentWorkspace ────────────────────────────────────────────────────────

export default function AgentWorkspace() {
  const currentThreadId = useGlobalStore((s) => s.agent.currentThreadId)
  const workspace = useGlobalStore((s) => s.workspace)
  const activeThreadId = currentThreadId ?? crypto.randomUUID()

  if (!currentThreadId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-5 bg-[#111] overflow-hidden px-4">
        <h2 className="text-2xl font-medium text-[#ddd] tracking-tight select-none">
          要在 <span className="text-white">{workspace.name || workspace.rootPath.split(/[\\/]/).pop() || '当前目录'}</span> 中构建什么？
        </h2>
        <InputBox centered threadId={activeThreadId} />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#111]">
      <MessageStream threadId={currentThreadId} />
      <div className="shrink-0 pb-1">
        <InputBox threadId={currentThreadId} />
      </div>
    </div>
  )
}
