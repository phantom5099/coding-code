import { useState, useRef, useCallback } from 'react'
import { useGlobalStore } from '../stores/global.store'
import { useAgent } from '../hooks/useAgent'
import MessageStream from './MessageStream'

// ─── ContextIndicator ──────────────────────────────────────────────────────

function ContextIndicator({ threadId }: { threadId: string }) {
  const contextUsage = useGlobalStore((s) => s.agent.contextUsage)
  const setContextUsage = useGlobalStore((s) => s.setContextUsage)

  if (!contextUsage) return null

  const pct = Math.min(contextUsage.used / contextUsage.contextWindow, 1)
  const color = pct < 0.4 ? '#4ec9b0' : pct < 0.75 ? '#e5c07b' : '#f44747'
  const r = 8
  const circ = 2 * Math.PI * r
  const dash = circ * (1 - pct)

  const handleCompress = async () => {
    await window.electronAPI?.compressContext?.(threadId)
    setContextUsage(null)
  }

  return (
    <button
      type="button"
      onClick={handleCompress}
      title={`上下文: ${Math.round(pct * 100)}% (${contextUsage.used.toLocaleString()} / ${contextUsage.contextWindow.toLocaleString()} tokens)\n点击压缩历史`}
      className="w-5 h-5 flex items-center justify-center hover:opacity-80 transition-opacity"
    >
      <svg width="20" height="20" viewBox="0 0 20 20">
        <circle cx="10" cy="10" r={r} fill="none" stroke="#2a2a2a" strokeWidth="2.5" />
        <circle
          cx="10" cy="10" r={r}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeDasharray={circ}
          strokeDashoffset={dash}
          strokeLinecap="round"
          transform="rotate(-90 10 10)"
        />
      </svg>
    </button>
  )
}

// ─── ModelSelector ─────────────────────────────────────────────────────────

function ModelSelector() {
  const model = useGlobalStore((s) => s.agent.model)
  const models = useGlobalStore((s) => s.agent.models)
  const setModel = useGlobalStore((s) => s.setModel)
  const [open, setOpen] = useState(false)

  // Group by provider
  const groups = models.reduce<Record<string, typeof models>>((acc, m) => {
    if (!acc[m.provider]) acc[m.provider] = []
    acc[m.provider]!.push(m)
    return acc
  }, {})

  const currentModel = models.find((m) => m.id === model)
  const displayName = currentModel
    ? currentModel.name
    : model.split('-').slice(-2).join(' ')

  const handleSelect = async (id: string) => {
    setModel(id)
    setOpen(false)
    await window.electronAPI?.setModel?.(id)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-2 py-1 text-xs text-[#555] hover:text-[#aaa] hover:bg-[#2a2a2a] rounded-lg transition-colors font-mono"
      >
        <span className="max-w-[120px] truncate">{displayName || '选择模型'}</span>
        <span className="text-[#3c3c3c]">▾</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full right-0 mb-1 bg-[#1e1e1e] border border-[#3c3c3c] rounded-lg shadow-xl min-w-[220px] z-50 py-1 max-h-[400px] overflow-y-auto">
            {Object.entries(groups).map(([provider, providerModels]) => (
              <div key={provider}>
                <div className="px-3 py-1 text-[10px] font-semibold text-[#4a4a4a] uppercase tracking-wider">
                  {provider}
                </div>
                {providerModels.map((m) => (
                  <button
                    type="button"
                    key={m.id}
                    onClick={() => handleSelect(m.id)}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[#094771] transition-colors flex items-center gap-2 ${
                      m.id === model ? 'text-[#4ec9b0]' : 'text-[#ccc]'
                    }`}
                  >
                    {m.id === model && <span className="shrink-0">✓</span>}
                    <span className={`flex-1 ${m.id === model ? '' : 'ml-3'}`}>{m.name}</span>
                    <span className="text-[#3c3c3c] text-[10px] shrink-0">
                      {(m.context_window / 1000).toFixed(0)}k
                    </span>
                  </button>
                ))}
              </div>
            ))}
            {models.length === 0 && (
              <div className="px-3 py-2 text-xs text-[#444]">无可用模型</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

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
            onClick={() => handlePolicyChange(POLICY_NEXT[approvalPolicy] ?? 'auto-edit')}
            className="flex items-center gap-1 px-2 py-1 text-xs text-[#666] hover:text-[#aaa] hover:bg-[#2a2a2a] rounded-lg transition-colors">
            <span className="text-[#569cd6]">⊙</span>
            <span>{POLICY_LABELS[approvalPolicy] ?? '自动审查'}</span>
            <span className="text-[#3c3c3c]">▾</span>
          </button>

          <div className="ml-auto flex items-center gap-2">
            <ContextIndicator threadId={threadId} />
            <ModelSelector />
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
