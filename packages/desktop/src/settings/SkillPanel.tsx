import { useState, useEffect } from 'react'

interface SkillEntry {
  name: string
  description: string
  source: 'global' | 'project'
  disabled: boolean
}

export default function SkillPanel() {
  const [skills, setSkills] = useState<SkillEntry[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const data = await window.electronAPI?.getSkills?.()
    setSkills(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const toggle = async (name: string, disabled: boolean) => {
    await window.electronAPI?.setSkillDisabled?.(name, disabled)
    setSkills((prev) => prev.map((s) => s.name === name ? { ...s, disabled } : s))
  }

  if (loading) {
    return <div className="px-4 py-6 text-xs text-[#444]">加载中…</div>
  }

  return (
    <div className="px-4 py-4">
      <p className="text-xs text-[#444] mb-4">
        来自 <span className="font-mono text-[#555]">~/.codingcode/skills/</span> 和 <span className="font-mono text-[#555]">.codingcode/skills/</span>
      </p>

      {skills.length === 0 ? (
        <div className="text-xs text-[#444] py-4 text-center">
          未找到 Skill<br />
          <span className="text-[#333]">在 .codingcode/skills/ 目录下创建 skill 文件夹以添加</span>
        </div>
      ) : (
        <div className="space-y-2">
          {skills.map((s) => (
            <div key={`${s.source}:${s.name}`}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a]">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[#ddd] truncate">{s.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    s.source === 'project'
                      ? 'bg-[#1a3a1a] text-[#4ec9b0]'
                      : 'bg-[#2a2a3a] text-[#9cdcfe]'
                  }`}>
                    {s.source === 'project' ? '项目' : '全局'}
                  </span>
                </div>
                {s.description && (
                  <div className="text-[11px] text-[#555] mt-0.5 truncate">{s.description}</div>
                )}
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
      title={checked ? '已启用' : '已禁用'}
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
