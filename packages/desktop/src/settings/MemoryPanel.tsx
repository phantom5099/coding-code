import { useState, useEffect } from 'react';
import { useAgentStore } from '../stores/agent.store';
import Toggle from './Toggle';
import {
  getMemoryConfig,
  setMemoryEnabled,
  setMemoryTypeDisabled,
  createMemoryExtraType,
  updateMemoryExtraType,
  deleteMemoryExtraType,
  setMemoryModel,
} from '../lib/core-api';

interface MemoryTypeEntry {
  name: string;
  description: string;
  isBuiltIn: boolean;
  disabled: boolean;
}

interface MemoryConfig {
  enabled: boolean;
  types: MemoryTypeEntry[];
  model: string;
}

interface FormType {
  name: string;
  description: string;
}

const EMPTY_FORM: FormType = { name: '', description: '' };

export default function MemoryPanel() {
  const models = useAgentStore((s) => s.models);
  const [config, setConfig] = useState<MemoryConfig>({
    enabled: false,
    types: [],
    model: '',
  });
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [form, setForm] = useState<FormType>(EMPTY_FORM);
  const load = async () => {
    setLoading(true);
    try {
      const data = await getMemoryConfig();
      setConfig({
        enabled: data.enabled ?? false,
        types: data.types ?? [],
        model: data.model ?? '',
      });
    } catch {
      setConfig({ enabled: false, types: [], model: '' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggleEnabled = async (v: boolean) => {
    await setMemoryEnabled(v);
    setConfig((prev) => ({ ...prev, enabled: v }));
  };

  const toggleType = async (name: string, disabled: boolean) => {
    await setMemoryTypeDisabled(name, disabled);
    setConfig((prev) => ({
      ...prev,
      types: prev.types.map((t) => (t.name === name ? { ...t, disabled } : t)),
    }));
  };

  const handleModel = async (model: string) => {
    setConfig((prev) => ({ ...prev, model }));
    try {
      await setMemoryModel(model);
    } catch {
      // revert on error
    }
  };

  const groups: Record<string, typeof models> = {};
  for (const m of models) {
    if (!groups[m.provider]) groups[m.provider] = [];
    groups[m.provider]!.push(m);
  }

  const startCreate = () => {
    setForm(EMPTY_FORM);
    setIsCreating(true);
    setEditingName(null);
    setDeletingName(null);
  };

  const startEdit = (t: MemoryTypeEntry) => {
    setForm({ name: t.name, description: t.description });
    setEditingName(t.name);
    setIsCreating(false);
    setDeletingName(null);
  };

  const cancelForm = () => {
    setIsCreating(false);
    setEditingName(null);
  };

  const saveForm = async () => {
    try {
      if (isCreating) {
        await createMemoryExtraType(form);
      } else if (editingName) {
        await updateMemoryExtraType(editingName, form);
      }
      cancelForm();
      await load();
    } catch (e: any) {
      alert(e.message ?? '操作失败');
    }
  };

  const confirmDelete = async () => {
    if (!deletingName) return;
    try {
      await deleteMemoryExtraType(deletingName);
      setDeletingName(null);
      await load();
    } catch (e: any) {
      alert(e.message ?? '删除失败');
    }
  };

  const inputCls =
    'w-full bg-[var(--bg-hover)] border border-[var(--border-hover)] text-[var(--text-title)] px-3 py-2 rounded text-[13px] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]';
  const labelCls = 'text-[12px] text-[var(--text-placeholder)] mb-1';
  const selectCls =
    'w-[200px] bg-[var(--bg-hover)] border border-[var(--border-hover)] text-[var(--text-title)] px-3 py-2 rounded text-[13px] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]';
  const btnPrimary =
    'px-4 py-2 rounded text-[13px] bg-[var(--btn-primary-bg)] text-[var(--accent-primary)] hover:bg-[var(--btn-primary-hover)]';
  const btnDanger =
    'px-4 py-2 rounded text-[13px] bg-[var(--btn-danger-bg)] text-[var(--accent-danger)] hover:bg-[var(--btn-danger-hover)]';
  const btnCancel =
    'px-4 py-2 rounded text-[13px] bg-[var(--border-card)] text-[var(--text-tertiary)] border border-[var(--border-hover)] hover:bg-[var(--border-hover)] hover:border-[var(--border-strong)]';

  if (loading) {
    return <div className="px-6 py-8 text-[14px] text-[var(--text-disabled)]">加载中…</div>;
  }

  return (
    <div className="px-6 py-5">
      <div className="flex items-center justify-between px-4 py-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-card)] mb-5">
        <div>
          <div className="text-[14px] text-[var(--text-title)]">记忆模式</div>
          <div className="text-[12px] text-[var(--text-placeholder)] mt-0.5">
            启用后自动从会话中提取长期记忆
          </div>
        </div>
        <Toggle checked={config.enabled} onChange={toggleEnabled} />
      </div>

      {config.enabled && (
        <>
          <div className="px-4 py-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-card)] mb-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[14px] text-[var(--text-title)]">记忆模型</div>
                <div className="text-[12px] text-[var(--text-placeholder)] mt-0.5">
                  用于提取和汇总记忆的模型，空则使用主对话模型
                </div>
              </div>
              <select
                value={config.model}
                onChange={(e) => handleModel(e.target.value)}
                className={selectCls}
              >
                <option value="">使用主对话模型</option>
                {Object.entries(groups).map(([provider, providerModels]) => (
                  <optgroup key={provider} label={provider}>
                    {providerModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

        </>
      )}

      <div className="flex items-center gap-2 mb-3">
        <div className="text-[11px] font-medium text-[var(--text-disabled)] uppercase tracking-wider">
          记忆类型
        </div>
        {config.enabled && (
          <button onClick={startCreate} className={btnPrimary}>
            + 添加类型
          </button>
        )}
      </div>

      {isCreating && (
        <div className="px-4 py-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--accent-primary)]/30 space-y-3 mb-2">
          <div>
            <div className={labelCls}>名称</div>
            <input
              className={inputCls}
              value={form.name}
              title="名称"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <div className={labelCls}>描述</div>
            <input
              className={inputCls}
              value={form.description}
              title="描述"
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={saveForm} className={btnPrimary}>
              保存
            </button>
            <button onClick={cancelForm} className={btnCancel}>
              取消
            </button>
          </div>
        </div>
      )}

      {!config.enabled ? (
        <div className="text-[14px] text-[var(--text-disabled)] py-8 text-center leading-loose">
          记忆模式已关闭
          <br />
          <span className="text-[13px] text-[var(--text-disabled)]">启用后可配置记忆类型</span>
        </div>
      ) : config.types.length === 0 && !isCreating ? (
        <div className="text-[14px] text-[var(--text-disabled)] py-8 text-center leading-loose">
          未配置记忆类型
          <br />
          <span className="text-[13px] text-[var(--text-disabled)]">
            点击上方按钮添加自定义类型
          </span>
        </div>
      ) : (
        <div className="space-y-2">
          {config.types.map((t) => {
            if (editingName === t.name) {
              return (
                <div
                  key={t.name}
                  className="px-4 py-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--accent-primary)]/30 space-y-3 mb-2"
                >
                  <div>
                    <div className={labelCls}>名称</div>
                    <input
                      className={inputCls}
                      value={form.name}
                      title="名称"
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <div className={labelCls}>描述</div>
                    <input
                      className={inputCls}
                      value={form.description}
                      title="描述"
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                    />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button onClick={saveForm} className={btnPrimary}>
                      保存
                    </button>
                    <button onClick={cancelForm} className={btnCancel}>
                      取消
                    </button>
                  </div>
                </div>
              );
            }
            if (deletingName === t.name) {
              return (
                <div
                  key={t.name}
                  className="flex items-center justify-between px-4 py-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--btn-danger-bg)]"
                >
                  <span className="text-[14px] text-[var(--accent-danger)]">
                    删除类型 {t.name}？
                  </span>
                  <div className="flex gap-2">
                    <button onClick={confirmDelete} className={btnDanger}>
                      确认
                    </button>
                    <button onClick={() => setDeletingName(null)} className={btnCancel}>
                      取消
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <div
                key={t.name}
                className="px-4 py-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-card)] group"
              >
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14px] text-[var(--text-title)]">{t.name}</span>
                      {t.isBuiltIn && (
                        <span className="text-[11px] px-2 py-0.5 rounded font-mono bg-[var(--tag-info-bg)] text-[var(--tag-info-text)]">
                          内置
                        </span>
                      )}
                      {!t.isBuiltIn && (
                        <span className="text-[11px] px-2 py-0.5 rounded font-mono bg-[var(--tag-action-bg)] text-[var(--tag-action-text)]">
                          自定义
                        </span>
                      )}
                    </div>
                    <div className="text-[12px] text-[var(--text-placeholder)] mt-1">
                      {t.description}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!t.isBuiltIn && (
                      <>
                        <button
                          title="编辑"
                          onClick={() => startEdit(t)}
                          className="text-[var(--text-disabled)] hover:text-[var(--text-tertiary)] transition-colors"
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                          </svg>
                        </button>
                        <button
                          title="删除"
                          onClick={() => setDeletingName(t.name)}
                          className="text-[var(--text-disabled)] hover:text-[var(--accent-danger)] transition-colors"
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </>
                    )}
                    <Toggle checked={!t.disabled} onChange={(v) => toggleType(t.name, !v)} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
