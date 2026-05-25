import { useState, useEffect } from 'react'

interface McpEntry {
  name: string
  transport: 'stdio' | 'http'
  disabled: boolean
  toolCount: number
}

export default function McpPanel() {
  const [servers, setServers] = useState<McpEntry[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const data = await window.electronAPI?.getMcp?.()
      setServers(data ?? [])
    } catch {
      setServers([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const toggle = async (name: string, disabled: boolean) => {
    await window.electronAPI?.setMcpDisabled?.(name, disabled)
    setServers((prev) => prev.map((s) => s.name === name ? { ...s, disabled } : s))
  }

  if (loading) {
    return <div className="px-6 py-8 text-[14px] text-[#444]">加载中…</div>
  }

  return (
    <div className="px-6 py-5">

      {servers.length === 0 ? (
        <div className="text-[14px] text-[#444] py-8 text-center leading-loose">
          未找到 MCP 服务器配置<br />
          <span className="text-[13px] text-[#333]">在项目根目录创建 .codingcode/mcp.yaml 以添加服务器</span>
        </div>
      ) : (
        <div className="space-y-3">
          {servers.map((s) => (
            <div key={s.name}
              className="flex items-center gap-4 px-4 py-3.5 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a]">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2.5">
                  <span className="text-[15px] text-[#ddd] truncate">{s.name}</span>
                  <span className={`text-[11px] px-2 py-0.5 rounded font-mono ${
                    s.transport === 'http' ? 'bg-[#1a3a5c] text-[#569cd6]' : 'bg-[#2a1a2a] text-[#c586c0]'
                  }`}>{s.transport}</span>
                </div>
                <div className="text-[13px] text-[#444] mt-1 font-mono">{s.toolCount} 个工具</div>
              </div>
              <Toggle checked={!s.disabled} onChange={(v) => toggle(s.name, !v)} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
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
