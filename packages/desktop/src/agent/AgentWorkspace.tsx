import { useState, useRef, useCallback, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
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
  const r = 7
  const circ = 2 * Math.PI * r
  return (
    <button type="button"
      onClick={async () => { await window.electronAPI?.compressContext?.(threadId); setContextUsage(null) }}
      title={`上下文: ${Math.round(pct * 100)}% (${contextUsage.used.toLocaleString()} / ${contextUsage.contextWindow.toLocaleString()} tokens)\n点击压缩`}
      className="w-5 h-5 flex items-center justify-center hover:opacity-70 transition-opacity">
      <svg width="18" height="18" viewBox="0 0 18 18">
        <circle cx="9" cy="9" r={r} fill="none" stroke="#2a2a2a" strokeWidth="2.5" />
        <circle cx="9" cy="9" r={r} fill="none" stroke={color} strokeWidth="2.5"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round" transform="rotate(-90 9 9)" />
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
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const groups = models.reduce<Record<string, typeof models>>((acc, m) => {
    if (!acc[m.provider]) acc[m.provider] = []
    acc[m.provider]!.push(m)
    return acc
  }, {})

  const currentModel = models.find((m) => m.id === model)
  const displayName = currentModel?.name ?? (model ? model.split('-').slice(-2).join(' ') : '')

  useLayoutEffect(() => {
    if (open && dropdownRef.current && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      dropdownRef.current.style.bottom = `${window.innerHeight - rect.top + 8}px`
      dropdownRef.current.style.right = `${window.innerWidth - rect.right}px`
    }
  }, [open])

  return (
    <div>
      <button ref={buttonRef} type="button" onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] text-[#555] hover:text-[#aaa] hover:bg-[#252525] rounded-lg transition-colors">
        <span className="max-w-[160px] truncate">{displayName || '选择模型'}</span>
        <span className="text-[#3c3c3c] text-[10px]">▾</span>
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div ref={dropdownRef} className="fixed bg-[#1e1e1e] border border-[#333] rounded-xl shadow-2xl min-w-[260px] z-50 py-1.5 max-h-[400px] overflow-y-auto">
            {Object.entries(groups).map(([provider, providerModels]) => (
              <div key={provider}>
                <div className="px-3 py-1.5 text-[11px] font-semibold text-[#444] uppercase tracking-wider">{provider}</div>
                {providerModels.map((m) => (
                  <button type="button" key={m.id} onClick={async () => { setModel(m.id); setOpen(false); await window.electronAPI?.setModel?.(m.id) }}
                    className={`w-full text-left px-3 py-2 text-[14px] hover:bg-[#094771] transition-colors flex items-center gap-2 ${m.id === model ? 'text-[#4ec9b0]' : 'text-[#ccc]'}`}>
                    <span className="w-4 shrink-0 text-center text-[12px]">{m.id === model ? '✓' : ''}</span>
                    <span className="flex-1">{m.name}</span>
                    <span className="text-[#3c3c3c] text-[12px] shrink-0">{(m.context_window / 1000).toFixed(0)}k</span>
                  </button>
                ))}
              </div>
            ))}
            {models.length === 0 && <div className="px-3 py-3 text-[14px] text-[#444]">无可用模型</div>}
          </div>
        </>,
        document.body
      )}
    </div>
  )
}

// ─── InputBox ──────────────────────────────────────────────────────────────

function InputBox({ centered, threadId }: { centered?: boolean; threadId: string }) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isStreaming = useGlobalStore((s) => {
    const turns = s.agent.threads[threadId]?.turns
    return turns ? turns.some((t) => t.status === 'running') : false
  })
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

  const POLICY_LABELS: Record<string, string> = { suggest: '自动审查', 'auto-edit': '自动编辑', 'full-auto': '全自动' }
  const POLICY_NEXT: Record<string, 'auto-edit' | 'full-auto' | 'suggest'> = {
    suggest: 'auto-edit', 'auto-edit': 'full-auto', 'full-auto': 'suggest',
  }

  return (
    <div className={centered ? 'w-full max-w-[740px]' : 'px-5 pb-5 pt-2'}>
      <div className="rounded-2xl border border-[#2d2d2d] bg-[#1c1c1c] hover:border-[#3a3a3a] focus-within:border-[#3a5a7a] transition-colors shadow-xl overflow-hidden">
        {/* Row 1: textarea + send button side by side */}
        <div className="flex items-center gap-2 pr-3">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder="可向 AI 询问任何事"
            disabled={isStreaming}
            rows={3}
            className="flex-1 bg-transparent px-5 pt-4 pb-3 text-[15px] text-[#d4d4d4] placeholder-[#333] resize-none outline-none leading-relaxed disabled:opacity-50"
          />
          {/* Send / Stop — vertically centered to the right of textarea */}
          {isStreaming ? (
            <button type="button" onClick={() => abort(threadId)}
              className="w-9 h-9 shrink-0 flex items-center justify-center bg-[#3a3a3a] hover:bg-[#4a4a4a] text-[#ccc] rounded-full transition-colors text-sm">
              ■
            </button>
          ) : (
            <button type="button" onClick={handleSend} disabled={!text.trim()}
              className="w-9 h-9 shrink-0 flex items-center justify-center bg-white disabled:bg-[#2a2a2a] disabled:text-[#444] text-[#111] rounded-full transition-colors font-bold text-base">
              ↑
            </button>
          )}
        </div>
        {/* Row 2: toolbar */}
        <div className="flex items-center gap-2 px-3 pb-3 pt-0">
          <button type="button"
            onClick={async () => {
              const next = POLICY_NEXT[approvalPolicy] ?? 'auto-edit'
              setApprovalPolicy(next)
              await window.electronAPI?.setApprovalPolicy?.(next)
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] text-[#555] hover:text-[#aaa] hover:bg-[#252525] rounded-lg transition-colors">
            <span className="text-[#569cd6] text-[10px]">⊙</span>
            <span>{POLICY_LABELS[approvalPolicy] ?? '自动审查'}</span>
            <span className="text-[#3c3c3c] text-[10px]">▾</span>
          </button>
          <div className="ml-auto flex items-center gap-2">
            <ContextIndicator threadId={threadId} />
            <ModelSelector />
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
      <div className="flex-1 flex flex-col items-center justify-center gap-6 bg-[#111] overflow-hidden px-6">
        <h2 className="text-[22px] font-medium text-[#ccc] tracking-tight select-none">
          在 <span className="text-white font-semibold">{workspace.name || workspace.rootPath.split(/[\\/]/).pop() || '当前目录'}</span> 中构建什么？
        </h2>
        <InputBox centered threadId={activeThreadId} />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#111]">
      <MessageStream threadId={currentThreadId} />
      <div className="shrink-0">
        <InputBox threadId={currentThreadId} />
      </div>
    </div>
  )
}
