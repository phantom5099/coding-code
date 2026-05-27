import { useState, useEffect, useRef } from 'react'
import Toggle from './Toggle'
import type { ModelEntry } from '../stores/global.store'

const AVAILABLE_TOOLS = [
  'read_file', 'write_file', 'edit_file', 'execute_command',
  'search_code', 'search_files', 'fetch_url', 'web_search',
  'todo_read', 'todo_write', 'tool_search', 'dispatch_agent',
]

interface AgentEntry {
  name: string
  description: string
  systemPrompt?: string
  tools?: string[]
  mcpServers?: string[]
  readonly?: boolean
  maxSteps?: number
  model?: string
  disabled?: boolean
}

interface AgentForm {
  name: string
  description: string
  systemPrompt: string
  tools: string[]
  mcpServers: string[]
  readonly: boolean
  maxSteps: string
  model: string
}

const EMPTY_FORM: AgentForm = {
  name: '', description: '', systemPrompt: '',
  tools: [], mcpServers: [], readonly: false, maxSteps: '', model: '',
}

const BUILT_IN = new Set(['explore', 'general'])

export default function SubagentsPanel() {
  const [agents, setAgents] = useState<AgentEntry[]>([])
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [models, setModels] = useState<ModelEntry[]>([])
  const [mcpList, setMcpList] = useState<string[]>([])
  const [isCreating, setIsCreating] = useState(false)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [deletingName, setDeletingName] = useState<string | null>(null)
  const [form, setForm] = useState<AgentForm>(EMPTY_FORM)

  const load = async () => {
    setLoading(true)
    try {
      const [agentData, enabledState, modelData, mcpData] = await Promise.all([
        window.electronAPI?.getAgents?.() ?? Promise.resolve([]),
        window.electronAPI?.getSubagentEnabled?.() ?? Promise.resolve(true),
        window.electronAPI?.getModels?.() ?? Promise.resolve([]),
        window.electronAPI?.getMcp?.() ?? Promise.resolve([]),
      ])
      setAgents(agentData ?? [])
      setEnabled(enabledState ?? true)
      setModels(modelData ?? [])
      setMcpList((mcpData ?? []).map((s: { name: string }) => s.name))
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

  const toggleAgent = async (name: string, disabled: boolean) => {
    await window.electronAPI?.setAgentDisabled?.(name, disabled)
    setAgents((prev) => prev.map((a) => a.name === name ? { ...a, disabled } : a))
  }

  const startCreate = () => {
    setForm(EMPTY_FORM)
    setIsCreating(true)
    setEditingName(null)
    setDeletingName(null)
  }

  const startEdit = (a: AgentEntry) => {
    setForm({
      name: a.name,
      description: a.description,
      systemPrompt: a.systemPrompt ?? '',
      tools: a.tools ?? [],
      mcpServers: a.mcpServers ?? [],
      readonly: a.readonly ?? false,
      maxSteps: a.maxSteps?.toString() ?? '',
      model: a.model ?? '',
    })
    setEditingName(a.name)
    setIsCreating(false)
    setDeletingName(null)
  }

  const cancelForm = () => {
    setIsCreating(false)
    setEditingName(null)
  }

  const saveForm = async () => {
    const profile: Record<string, unknown> = {
      name: form.name,
      description: form.description,
      systemPrompt: form.systemPrompt,
    }
    if (form.tools.length > 0) profile.tools = form.tools
    if (form.mcpServers.length > 0) profile.mcpServers = form.mcpServers
    if (form.readonly) profile.readonly = true
    if (form.maxSteps.trim()) profile.maxSteps = Number(form.maxSteps)
    if (form.model.trim()) profile.model = form.model

    try {
      if (isCreating) {
        await window.electronAPI?.createAgent?.(profile)
      } else if (editingName) {
        await window.electronAPI?.updateAgent?.(editingName, profile)
      }
      cancelForm()
      await load()
    } catch (e: any) {
      alert(e.message ?? '操作失败')
    }
  }

  const confirmDelete = async () => {
    if (!deletingName) return
    try {
      await window.electronAPI?.deleteAgent?.(deletingName)
      setDeletingName(null)
      await load()
    } catch (e: any) {
      alert(e.message ?? '删除失败')
    }
  }

  const inputCls = 'w-full bg-[#252525] border border-[#3a3a3a] text-[#ddd] px-3 py-2 rounded text-[13px] focus:outline-none focus:ring-1 focus:ring-[#569cd6]'
  const labelCls = 'text-[12px] text-[#555] mb-1'
  const btnPrimary = 'px-4 py-2 rounded text-[13px] bg-[#1a3a5c] text-[#569cd6] hover:bg-[#1a4a6c]'
  const btnDanger = 'px-4 py-2 rounded text-[13px] bg-[#3a1a1a] text-[#d16969] hover:bg-[#4a1a1a]'
  const btnCancel = 'px-4 py-2 rounded text-[13px] bg-[#2a2a2a] text-[#888] hover:bg-[#3a3a3a]'

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

      <div className="flex items-center gap-2 mb-3">
        <div className="text-[11px] font-medium text-[#444] uppercase tracking-wider">
          已注册的子智能体
        </div>
        <button onClick={startCreate} className={btnPrimary}>
          + 添加智能体
        </button>
      </div>

      {isCreating && (
        <FormCard
          form={form} setForm={setForm}
          models={models} mcpList={mcpList}
          onSave={saveForm} onCancel={cancelForm}
          inputCls={inputCls} labelCls={labelCls}
          btnPrimary={btnPrimary} btnCancel={btnCancel}
        />
      )}

      {agents.length === 0 && !isCreating ? (
        <div className="text-[14px] text-[#444] py-8 text-center leading-loose">
          未找到子智能体配置<br />
          <span className="text-[13px] text-[#333]">点击上方按钮添加</span>
        </div>
      ) : (
        <div className="space-y-2">
          {agents.map((a) => {
            if (editingName === a.name) {
              return (
                <FormCard
                  key={a.name}
                  form={form} setForm={setForm}
                  models={models} mcpList={mcpList}
                  onSave={saveForm} onCancel={cancelForm}
                  inputCls={inputCls} labelCls={labelCls}
                  btnPrimary={btnPrimary} btnCancel={btnCancel}
                />
              )
            }
            if (deletingName === a.name) {
              return (
                <div key={a.name}
                  className="flex items-center justify-between px-4 py-3.5 rounded-xl bg-[#1a1a1a] border border-[#3a1a1a]">
                  <span className="text-[14px] text-[#d16969]">删除智能体 {a.name}？</span>
                  <div className="flex gap-2">
                    <button onClick={confirmDelete} className={btnDanger}>确认</button>
                    <button onClick={() => setDeletingName(null)} className={btnCancel}>取消</button>
                  </div>
                </div>
              )
            }
            const isBuiltIn = BUILT_IN.has(a.name)
            return (
              <div key={a.name}
                className="px-4 py-3.5 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] group">
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
                      {isBuiltIn && (
                        <span className="text-[11px] px-2 py-0.5 rounded font-mono bg-[#2a2a2a] text-[#555]">
                          内置
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
                    {a.mcpServers && a.mcpServers.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {a.mcpServers.map((s) => (
                          <span key={s} className="text-[11px] px-1.5 py-0.5 rounded bg-[#1a2a1a] text-[#4ec9b0] font-mono">
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!isBuiltIn && (
                      <>
                        <button
                          title="编辑"
                          onClick={() => startEdit(a)}
                          className="text-[#444] hover:text-[#888] transition-colors"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                          </svg>
                        </button>
                        <button
                          title="删除"
                          onClick={() => setDeletingName(a.name)}
                          className="text-[#444] hover:text-[#d16969] transition-colors"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                          </svg>
                        </button>
                      </>
                    )}
                    <Toggle checked={!a.disabled} onChange={(v) => toggleAgent(a.name, !v)} />
                    {a.maxSteps !== undefined && (
                      <span className="text-[11px] text-[#444]">{a.maxSteps} 步</span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ToolMultiSelect({ selected, onChange, inputCls }: {
  selected: string[]
  onChange: (tools: string[]) => void
  inputCls: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const toggle = (tool: string) => {
    if (selected.includes(tool)) onChange(selected.filter(t => t !== tool))
    else onChange([...selected, tool])
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`${inputCls} flex items-center justify-between text-left`}
      >
        <span className={selected.length === 0 ? 'text-[#555]' : ''}>
          {selected.length === 0 ? '未指定（全部工具）' : selected.join(', ')}
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`shrink-0 ml-2 transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="m6 9 6 6 6-6"/>
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded border border-[#3a3a3a] bg-[#1e1e1e] py-1 shadow-lg">
          {AVAILABLE_TOOLS.map(tool => (
            <label key={tool}
              className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-[#2a2a2a] text-[13px] text-[#ccc]">
              <input
                type="checkbox"
                checked={selected.includes(tool)}
                onChange={() => toggle(tool)}
                className="accent-[#569cd6]"
              />
              <span className="font-mono">{tool}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function McpMultiSelect({ selected, onChange, availableMcpServers, inputCls }: {
  selected: string[]
  onChange: (servers: string[]) => void
  availableMcpServers: string[]
  inputCls: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const toggle = (server: string) => {
    if (selected.includes(server)) onChange(selected.filter(s => s !== server))
    else onChange([...selected, server])
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`${inputCls} flex items-center justify-between text-left`}
      >
        <span className={selected.length === 0 ? 'text-[#555]' : ''}>
          {selected.length === 0 ? '未指定（不限制 MCP）' : selected.join(', ')}
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`shrink-0 ml-2 transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="m6 9 6 6 6-6"/>
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded border border-[#3a3a3a] bg-[#1e1e1e] py-1 shadow-lg">
          {availableMcpServers.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-[#555]">无已配置的 MCP 服务器</div>
          ) : (
            availableMcpServers.map(server => (
              <label key={server}
                className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-[#2a2a2a] text-[13px] text-[#ccc]">
                <input
                  type="checkbox"
                  checked={selected.includes(server)}
                  onChange={() => toggle(server)}
                  className="accent-[#4ec9b0]"
                />
                <span className="font-mono">{server}</span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function FormCard({ form, setForm, models, mcpList, onSave, onCancel, inputCls, labelCls, btnPrimary, btnCancel }: {
  form: AgentForm
  setForm: (f: AgentForm) => void
  models: ModelEntry[]
  mcpList: string[]
  onSave: () => void
  onCancel: () => void
  inputCls: string
  labelCls: string
  btnPrimary: string
  btnCancel: string
}) {
  const modelGroups = models.reduce<Record<string, typeof models>>((acc, m) => {
    if (!acc[m.provider]) acc[m.provider] = []
    acc[m.provider]!.push(m)
    return acc
  }, {})
  return (
    <div className="px-4 py-3.5 rounded-xl bg-[#1a1a1a] border border-[#569cd6]/30 space-y-3 mb-2">
      <div>
        <div className={labelCls}>名称</div>
        <input className={inputCls} value={form.name} title="名称"
          onChange={e => setForm({ ...form, name: e.target.value })} />
      </div>
      <div>
        <div className={labelCls}>描述</div>
        <input className={inputCls} value={form.description} title="描述"
          onChange={e => setForm({ ...form, description: e.target.value })} />
      </div>
      <div>
        <div className={labelCls}>系统提示词 (systemPrompt)</div>
        <textarea className={`${inputCls} h-24`} value={form.systemPrompt} title="系统提示词"
          onChange={e => setForm({ ...form, systemPrompt: e.target.value })} />
      </div>
      <div>
        <div className={labelCls}>工具列表 (可选)</div>
        <ToolMultiSelect
          selected={form.tools}
          onChange={tools => setForm({ ...form, tools })}
          inputCls={inputCls}
        />
      </div>
      <div>
        <div className={labelCls}>MCP 服务器 (可选)</div>
        <McpMultiSelect
          selected={form.mcpServers}
          onChange={mcpServers => setForm({ ...form, mcpServers })}
          availableMcpServers={mcpList}
          inputCls={inputCls}
        />
      </div>
      <div className="flex gap-4 items-end">
        <div className="flex-1">
          <div className={labelCls}>最大步数 (可选)</div>
          <input type="number" min={1} className={inputCls} value={form.maxSteps} title="最大步数"
            onChange={e => setForm({ ...form, maxSteps: e.target.value })} />
        </div>
        <div className="flex-1">
          <div className={labelCls}>模型 (可选)</div>
          <select className={inputCls} value={form.model} title="模型"
            onChange={e => setForm({ ...form, model: e.target.value })}>
            <option value="">未指定</option>
            {Object.entries(modelGroups).map(([provider, providerModels]) => (
              <optgroup key={provider} label={provider.toUpperCase()}>
                {providerModels.map(m => (
                  <option key={m.id} value={m.id}>{m.name} ({(m.context_window / 1000).toFixed(0)}k)</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-[13px] text-[#888] cursor-pointer">
          <input type="checkbox" checked={form.readonly}
            onChange={e => setForm({ ...form, readonly: e.target.checked })}
            className="accent-[#569cd6]" />
          只读模式
        </label>
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={onSave} className={btnPrimary}>保存</button>
        <button onClick={onCancel} className={btnCancel}>取消</button>
      </div>
    </div>
  )
}
