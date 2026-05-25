import { useState, useEffect } from 'react'

interface AgentEntry {
  name: string
  description: string
  tools?: string[]
  readonly?: boolean
  maxSteps?: number
  model?: string
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      aria-label={checked ? '禁用' : '启用'}
      onClick={() => onChange(!checked)}
      className={`relative w-8 h-4 rounded-full transition-colors shrink-0 ${
        checked ? 'bg-[#569cd6]' : 'bg-[#3a3a3a]'
      }`}
    >
      <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
        checked ? 'translate-x-4' : 'translate-x-0.5'
      }`} />
    </button>
  )
}

export default function SubagentsPanel() {
  const [agents, setAgents] = useState<AgentEntry[]>([])
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const [agentData, enabledState] = await Promise.all([
        window.electronAPI?.getAgents?.() ?? Promise.resolve([]),
        window.electronAPI?.getSubagentEnabled?.() ?? Promise.resolve(true),
      ])
      setAgents(agentData ?? [])
      setEnabled(enabledState ?? true)
    } catch {
      setAgents([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const toggleEnabled = async (v: boolean) => {
    await window.electronAPI?.setSubagentEnabled?.(v)
    setEnabled(v)
  }

  if (loading) {
    return <div className="px-6 py-8 text-[14px] text-[#444]">加载中…</div>
  }

  return (
    <div className="px-6 py-5">
      {/* Global enable toggle */}
      <div className="flex items-center justify-between px-4 py-3.5 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] mb-5">
        <div>
          <div className="text-[14px] text-[#ddd]">启用子智能体</div>
          <div className="text-[12px] text-[#555] mt-0.5">允许 agent 派发子任务给子智能体</div>
        </div>
        <Toggle checked={enabled} onChange={toggleEnabled} />
      </div>

      <div className="text-[11px] font-medium text-[#444] uppercase tracking-wider mb-2 px-1">
        已注册的子智能体
      </div>

      {agents.length === 0 ? (
        <div className="text-[14px] text-[#444] py-8 text-center leading-loose">
          未找到子智能体配置<br />
          <span className="text-[13px] text-[#333]">在 .codingcode/agents/ 目录下创建 .md 文件以添加</span>
        </div>
      ) : (
        <div className="space-y-2">
          {agents.map((a) => (
            <div key={a.name}
              className="px-4 py-3.5 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a]">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[14px] text-[#ddd]">{a.name}</span>
                    {a.readonly && (
                      <span className="text-[11px] px-2 py-0.5 rounded font-mono bg-[#1a2a1a] text-[#6a9955]">
                        只读
                      </span>
                    )}
                    {a.model && (
                      <span className="text-[11px] px-2 py-0.5 rounded font-mono bg-[#1a1a3a] text-[#569cd6]">
                        {a.model}
                      </span>
                    )}
                  </div>
                  <div className="text-[12px] text-[#555] mt-1">{a.description}</div>
                  {a.tools && a.tools.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {a.tools.map((t) => (
                        <span key={t} className="text-[11px] px-1.5 py-0.5 rounded bg-[#222] text-[#666] font-mono">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {a.maxSteps !== undefined && (
                  <span className="text-[11px] text-[#444] shrink-0 mt-0.5">{a.maxSteps} 步</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
