import { useState, useEffect } from 'react';
import Toggle from './Toggle';
import { useGlobalStore } from '../stores/global.store';
import {
  listHooks,
  createHook,
  updateHook,
  deleteHook,
  setHookDisabled,
  resetHookDisabled,
} from '../lib/core-api';

interface HookEntry {
  name: string;
  description?: string;
  point: string;
  type: 'observer' | 'decision';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  priority?: number;
  enabled: boolean;
  source?: 'global' | 'project';
  hasProjectOverride?: boolean;
}

interface HookGroup {
  label: string;
  points: { name: string; description: string; type: 'observer' | 'decision' }[];
}

const HOOK_GROUPS: HookGroup[] = [
  {
    label: '工具执行',
    points: [
      { name: 'tool.execute.before', description: '工具执行前触发', type: 'decision' },
      { name: 'tool.execute.after', description: '工具执行成功后触发', type: 'observer' },
      { name: 'tool.execute.error', description: '工具执行失败后触发', type: 'observer' },
      { name: 'tool.execute.denied', description: '工具被拒绝执行后触发', type: 'observer' },
      { name: 'tool.approval.pre', description: '工具审批请求前触发', type: 'decision' },
      { name: 'tool.approval.post', description: '工具审批完成后触发', type: 'observer' },
    ],
  },
  {
    label: 'LLM 请求',
    points: [
      { name: 'llm.request.before', description: '向模型发送请求前触发', type: 'decision' },
      { name: 'llm.response.after', description: '收到模型响应后触发', type: 'observer' },
      { name: 'llm.response.error', description: '模型响应出错时触发', type: 'observer' },
    ],
  },
  {
    label: '会话',
    points: [
      { name: 'session.save.before', description: '保存会话前触发', type: 'observer' },
      { name: 'session.save.after', description: '保存会话后触发', type: 'observer' },
    ],
  },
  {
    label: 'Agent 轮次',
    points: [
      { name: 'agent.turn.start', description: '每一轮对话开始时触发', type: 'observer' },
      { name: 'agent.step.before', description: '每个推理步骤前触发', type: 'decision' },
      {
        name: 'agent.turn.stop',
        description: 'Agent 本轮无工具调用、准备停止时裁决，可返回 continue 续行',
        type: 'decision',
      },
      { name: 'agent.turn.end', description: '轮次最终结束时通知，不可干预', type: 'observer' },
    ],
  },
  {
    label: '子智能体',
    points: [
      { name: 'agent.subagent.spawn.before', description: '派生子智能体前触发', type: 'decision' },
      { name: 'agent.subagent.spawn.after', description: '子智能体派生后触发', type: 'observer' },
      { name: 'agent.subagent.complete', description: '子智能体任务完成时触发', type: 'observer' },
    ],
  },
];

const ALL_POINTS = HOOK_GROUPS.flatMap((g) => g.points);

interface HookForm {
  name: string;
  description: string;
  point: string;
  command: string;
  args: string;
  env: string;
  priority: string;
  enabled: boolean;
}

const EMPTY_FORM: HookForm = {
  name: '',
  description: '',
  point: ALL_POINTS[0]?.name ?? '',
  command: '',
  args: '',
  env: '',
  priority: '0',
  enabled: true,
};

export default function HooksPanel({ global: isGlobal }: { global?: boolean }) {
  const [hooks, setHooks] = useState<HookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [form, setForm] = useState<HookForm>(EMPTY_FORM);
  const rootPath = useGlobalStore((s) => s.workspace.rootPath);
  const cwd = isGlobal ? undefined : rootPath;

  const load = async () => {
    setLoading(true);
    try {
      const data = await listHooks(cwd);
      setHooks(data ?? []);
    } catch {
      setHooks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [rootPath]);

  const startCreate = () => {
    setForm(EMPTY_FORM);
    setIsCreating(true);
    setEditingName(null);
    setDeletingName(null);
  };

  const startEdit = (h: HookEntry) => {
    setForm({
      name: h.name,
      description: h.description ?? '',
      point: h.point,
      command: h.command,
      args: (h.args ?? []).join(', '),
      env: h.env
        ? Object.entries(h.env)
            .map(([k, v]) => `${k}=${v}`)
            .join('\n')
        : '',
      priority: (h.priority ?? 0).toString(),
      enabled: h.enabled,
    });
    setEditingName(h.name);
    setIsCreating(false);
    setDeletingName(null);
  };

  const cancelForm = () => {
    setIsCreating(false);
    setEditingName(null);
  };

  const saveForm = async () => {
    const hook: Record<string, unknown> = {
      name: form.name,
      point: form.point,
      type: ALL_POINTS.find((p) => p.name === form.point)?.type ?? 'observer',
      command: form.command,
      enabled: form.enabled,
    };
    if (form.description.trim()) hook.description = form.description;
    if (form.args.trim())
      hook.args = form.args
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    if (form.env.trim()) {
      hook.env = Object.fromEntries(
        form.env
          .split('\n')
          .map((l) => l.split('='))
          .filter((a) => a[0])
      );
    }
    if (form.priority.trim()) hook.priority = Number(form.priority);

    try {
      if (isCreating) {
        await createHook(cwd, hook);
      } else if (editingName) {
        await updateHook(cwd, editingName, hook);
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
      await deleteHook(cwd, deletingName);
      setDeletingName(null);
      await load();
    } catch (e: any) {
      alert(e.message ?? '删除失败');
    }
  };

  const inputCls =
    'w-full bg-[var(--bg-hover)] border border-[var(--border-hover)] text-[var(--text-title)] px-3 py-2 rounded text-[13px] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]';
  const labelCls = 'text-[12px] text-[var(--text-placeholder)] mb-1';
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
      <div className="flex items-center gap-2 mb-3">
        <div className="text-[11px] font-medium text-[var(--text-disabled)] uppercase tracking-wider">
          用户自定义钩子
        </div>
        <button onClick={startCreate} className={btnPrimary}>
          + 添加钩子
        </button>
      </div>

      {isCreating && (
        <FormCard
          form={form}
          setForm={setForm}
          points={ALL_POINTS}
          onSave={saveForm}
          onCancel={cancelForm}
          inputCls={inputCls}
          labelCls={labelCls}
          btnPrimary={btnPrimary}
          btnCancel={btnCancel}
        />
      )}

      {hooks.length === 0 && !isCreating ? (
        <div className="text-[14px] text-[var(--text-disabled)] py-6 text-center leading-loose">
          未找到用户自定义钩子
          <br />
          <span className="text-[13px] text-[var(--text-disabled)]">点击上方按钮添加</span>
        </div>
      ) : (
        <div className="space-y-2 mb-8">
          {hooks.map((h) => {
            if (editingName === h.name) {
              return (
                <FormCard
                  key={h.name}
                  form={form}
                  setForm={setForm}
                  points={ALL_POINTS}
                  onSave={saveForm}
                  onCancel={cancelForm}
                  inputCls={inputCls}
                  labelCls={labelCls}
                  btnPrimary={btnPrimary}
                  btnCancel={btnCancel}
                />
              );
            }
            if (deletingName === h.name) {
              return (
                <div
                  key={h.name}
                  className="flex items-center justify-between px-4 py-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--btn-danger-bg)]"
                >
                  <span className="text-[14px] text-[var(--accent-danger)]">
                    删除钩子 {h.name}？
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
                key={h.name}
                className="flex items-start gap-3 px-4 py-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-card)] group"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[14px] text-[var(--text-title)]">{h.name}</span>
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded font-mono ${
                        h.type === 'decision'
                          ? 'bg-[var(--tag-decision-bg)] text-[var(--tag-decision-text)]'
                          : 'bg-[var(--tag-action-bg)] text-[var(--tag-action-text)]'
                      }`}
                    >
                      {h.type}
                    </span>
                    <span className="text-[11px] px-2 py-0.5 rounded font-mono bg-[var(--tag-info-bg)] text-[var(--tag-info-text)]">
                      {h.point}
                    </span>
                    {h.source === 'global' && (
                      <span className="text-[11px] px-2 py-0.5 rounded bg-[var(--tag-info-bg)] text-[var(--tag-info-text)]">
                        全局
                      </span>
                    )}
                    {h.source === 'project' && (
                      <span className="text-[11px] px-2 py-0.5 rounded bg-[var(--tag-action-bg)] text-[var(--tag-action-text)]">
                        项目
                      </span>
                    )}
                    {h.hasProjectOverride && (
                      <span className="text-[11px] px-2 py-0.5 rounded bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]">
                        覆盖全局
                      </span>
                    )}
                    {!h.enabled && (
                      <span className="text-[11px] px-2 py-0.5 rounded font-mono bg-[var(--tag-decision-bg)] text-[var(--tag-decision-text)]">
                        已禁用
                      </span>
                    )}
                  </div>
                  {h.description && (
                    <div className="text-[12px] text-[var(--text-placeholder)] mt-1">
                      {h.description}
                    </div>
                  )}
                  <div className="text-[12px] text-[var(--text-disabled)] mt-1 font-mono">
                    {h.command}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    title="编辑"
                    onClick={() => startEdit(h)}
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
                    onClick={() => setDeletingName(h.name)}
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
                  <Toggle
                    checked={h.enabled}
                    onChange={(v) => {
                      setHookDisabled(cwd, h.name, !v).catch((e) => {
                        console.error('Failed to set hook disabled:', e);
                      });
                      setHooks((prev) =>
                        prev.map((hh) => (hh.name === h.name ? { ...hh, enabled: v } : hh))
                      );
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="text-[11px] font-medium text-[var(--text-disabled)] uppercase tracking-wider mb-3 px-1">
        可用挂载点 (18 个内置)
      </div>

      <div className="space-y-6">
        {HOOK_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="text-[11px] font-medium text-[var(--text-disabled)] uppercase tracking-wider mb-2 px-1">
              {group.label}
            </div>
            <div className="space-y-1">
              {group.points.map((point) => (
                <div
                  key={point.name}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-default)]"
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-[13px] font-mono text-[var(--text-title)]">
                      {point.name}
                    </span>
                    <div className="text-[12px] text-[var(--text-placeholder)] mt-0.5">
                      {point.description}
                    </div>
                  </div>
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded font-mono shrink-0 ${
                      point.type === 'decision'
                        ? 'bg-[var(--tag-decision-bg)] text-[var(--tag-decision-text)]'
                        : 'bg-[var(--tag-action-bg)] text-[var(--tag-action-text)]'
                    }`}
                  >
                    {point.type}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FormCard({
  form,
  setForm,
  points,
  onSave,
  onCancel,
  inputCls,
  labelCls,
  btnPrimary,
  btnCancel,
}: {
  form: HookForm;
  setForm: (f: HookForm) => void;
  points: { name: string }[];
  onSave: () => void;
  onCancel: () => void;
  inputCls: string;
  labelCls: string;
  btnPrimary: string;
  btnCancel: string;
}) {
  return (
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
      <div className="flex gap-4">
        <div className="flex-1">
          <div className={labelCls}>挂载点</div>
          <select
            className={inputCls}
            value={form.point}
            title="挂载点"
            onChange={(e) => setForm({ ...form, point: e.target.value })}
          >
            {points.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <div className={labelCls}>命令</div>
        <input
          className={inputCls}
          value={form.command}
          title="命令"
          onChange={(e) => setForm({ ...form, command: e.target.value })}
        />
      </div>
      <div>
        <div className={labelCls}>参数 (逗号分隔，可选)</div>
        <input
          className={inputCls}
          value={form.args}
          title="参数"
          onChange={(e) => setForm({ ...form, args: e.target.value })}
        />
      </div>
      <div>
        <div className={labelCls}>环境变量 (每行 KEY=value，可选)</div>
        <textarea
          className={`${inputCls} h-16`}
          value={form.env}
          title="环境变量"
          onChange={(e) => setForm({ ...form, env: e.target.value })}
        />
      </div>
      <div className="flex gap-4 items-end">
        <div className="w-24">
          <div className={labelCls}>优先级</div>
          <input
            type="number"
            className={inputCls}
            value={form.priority}
            title="优先级"
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
          />
        </div>
        <div className="pb-1">
          <label className="flex items-center gap-2 text-[13px] text-[var(--text-tertiary)] cursor-pointer">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              className="accent-[var(--accent-primary)]"
            />
            启用
          </label>
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={onSave} className={btnPrimary}>
          保存
        </button>
        <button onClick={onCancel} className={btnCancel}>
          取消
        </button>
      </div>
    </div>
  );
}
