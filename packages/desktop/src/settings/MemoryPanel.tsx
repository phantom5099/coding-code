import { useState, useEffect } from 'react'
import Toggle from './Toggle'
import {
  getMemoryConfig, setMemoryEnabled, setMemoryTypeDisabled,
  createMemoryExtraType, updateMemoryExtraType, deleteMemoryExtraType,
} from '../lib/core-api'

interface MemoryTypeEntry {
  name: string
  description: string
  isBuiltIn: boolean
  disabled: boolean
}

interface MemoryConfig {
  enabled: boolean
  types: MemoryTypeEntry[]
}

interface FormType {
  name: string
  description: string
}

const EMPTY_FORM: FormType = { name: '', description: '' }

export default function MemoryPanel() {
  const [config, setConfig] = useState<MemoryConfig>({ enabled: false, types: [] })
  const [loading, setLoading] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [deletingName, setDeletingName] = useState<string | null>(null)
  const [form, setForm] = useState<FormType>(EMPTY_FORM)

  const load = async () => {
    setLoading(true)
    try {
      const data = await getMemoryConfig()
      setConfig(data ?? { enabled: false, types: [] })
    } catch {
      setConfig({ enabled: false, types: [] })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const toggleEnabled = async (v: boolean) => {
    await setMemoryEnabled(v)
    setConfig(prev => ({ ...prev, enabled: v }))
  }

  const toggleType = async (name: string, disabled: boolean) => {
    await setMemoryTypeDisabled(name, disabled)
    setConfig(prev => ({
      ...prev,
      types: prev.types.map(t => t.name === name ? { ...t, disabled } : t),
    }))
  }

  const startCreate = () => {
    setForm(EMPTY_FORM)
    setIsCreating(true)
    setEditingName(null)
    setDeletingName(null)
  }

  const startEdit = (t: MemoryTypeEntry) => {
    setForm({ name: t.name, description: t.description })
    setEditingName(t.name)
    setIsCreating(false)
    setDeletingName(null)
  }

  const cancelForm = () => {
    setIsCreating(false)
    setEditingName(null)
  }

  const saveForm = async () => {
    try {
      if (isCreating) {
        await createMemoryExtraType(form)
      } else if (editingName) {
        await updateMemoryExtraType(editingName, form)
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
      await deleteMemoryExtraType(deletingName)
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
      <div className="flex items-center justify-between px-4 py-3.5 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] mb-5">
        <div>
          <div className="text-[14px] text-[#ddd]">记忆模式</div>
          <div className="text-[12px] text-[#555] mt-0.5">启用后自动从会话中提取长期记忆</div>
        </div>
        <Toggle checked={config.enabled} onChange={toggleEnabled} />
      </div>

      <div className="flex items-center gap-2 mb-3">
        <div className="text-[11px] font-medium text-[#444] uppercase tracking-wider">
          记忆类型
        </div>
        {config.enabled && (
          <button onClick={startCreate} className={btnPrimary}>
            + 添加类型
          </button>
        )}
      </div>

      {isCreating && (
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
          <div className="flex gap-2 pt-1">
            <button onClick={saveForm} className={btnPrimary}>保存</button>
            <button onClick={cancelForm} className={btnCancel}>取消</button>
          </div>
        </div>
      )}

      {!config.enabled ? (
        <div className="text-[14px] text-[#444] py-8 text-center leading-loose">
          记忆模式已关闭<br />
          <span className="text-[13px] text-[#333]">启用后可配置记忆类型</span>
        </div>
      ) : config.types.length === 0 && !isCreating ? (
        <div className="text-[14px] text-[#444] py-8 text-center leading-loose">
          未配置记忆类型<br />
          <span className="text-[13px] text-[#333]">点击上方按钮添加自定义类型</span>
        </div>
      ) : (
        <div className="space-y-2">
          {config.types.map((t) => {
            if (editingName === t.name) {
              return (
                <div key={t.name} className="px-4 py-3.5 rounded-xl bg-[#1a1a1a] border border-[#569cd6]/30 space-y-3 mb-2">
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
                  <div className="flex gap-2 pt-1">
                    <button onClick={saveForm} className={btnPrimary}>保存</button>
                    <button onClick={cancelForm} className={btnCancel}>取消</button>
                  </div>
                </div>
              )
            }
            if (deletingName === t.name) {
              return (
                <div key={t.name}
                  className="flex items-center justify-between px-4 py-3.5 rounded-xl bg-[#1a1a1a] border border-[#3a1a1a]">
                  <span className="text-[14px] text-[#d16969]">删除类型 {t.name}？</span>
                  <div className="flex gap-2">
                    <button onClick={confirmDelete} className={btnDanger}>确认</button>
                    <button onClick={() => setDeletingName(null)} className={btnCancel}>取消</button>
                  </div>
                </div>
              )
            }
            return (
              <div key={t.name}
                className="px-4 py-3.5 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] group">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14px] text-[#ddd]">{t.name}</span>
                      {t.isBuiltIn && (
                        <span className="text-[11px] px-2 py-0.5 rounded font-mono bg-[#2a2a2a] text-[#555]">
                          内置
                        </span>
                      )}
                      {!t.isBuiltIn && (
                        <span className="text-[11px] px-2 py-0.5 rounded font-mono bg-[#1a2a1a] text-[#6a9955]">
                          自定义
                        </span>
                      )}
                    </div>
                    <div className="text-[12px] text-[#555] mt-1">{t.description}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!t.isBuiltIn && (
                      <>
                        <button
                          title="编辑"
                          onClick={() => startEdit(t)}
                          className="text-[#444] hover:text-[#888] transition-colors"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                          </svg>
                        </button>
                        <button
                          title="删除"
                          onClick={() => setDeletingName(t.name)}
                          className="text-[#444] hover:text-[#d16969] transition-colors"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                          </svg>
                        </button>
                      </>
                    )}
                    <Toggle checked={!t.disabled} onChange={(v) => toggleType(t.name, !v)} />
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
