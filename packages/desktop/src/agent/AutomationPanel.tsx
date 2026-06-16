import { useEffect, useState } from 'react';
import { ArrowLeft, Plus, Play, Trash2, Power, Clock, FolderOpen } from 'lucide-react';
import { useAgentStore, type Automation } from '../stores/agent.store';
import { useWorkspaceStore } from '../stores/workspace.store';
import { useUIStore } from '../stores/ui.store';
import {
  listAutomations,
  deleteAutomation,
  updateAutomation,
  runAutomationOnce,
} from '../lib/core-api';
import { AutomationForm } from './AutomationForm';

export function AutomationPanel() {
  const automations = useAgentStore((s) => s.automations);
  const setAutomations = useAgentStore((s) => s.setAutomations);
  const workspace = useWorkspaceStore();
  const setView = useUIStore((s) => s.setView);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadAutomations();
  }, []);

  async function loadAutomations() {
    try {
      const data = await listAutomations();
      setAutomations(data);
    } catch (e) {
      console.error('Failed to load automations:', e);
    }
  }

  async function handleToggle(id: string, enabled: boolean) {
    try {
      await updateAutomation(id, { enabled });
      await loadAutomations();
    } catch (e) {
      console.error('Failed to toggle automation:', e);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteAutomation(id);
      await loadAutomations();
    } catch (e) {
      console.error('Failed to delete automation:', e);
    }
  }

  async function handleRunOnce(id: string) {
    setLoading(true);
    try {
      await runAutomationOnce(id);
      await loadAutomations();
    } catch (e) {
      console.error('Failed to run automation:', e);
    } finally {
      setLoading(false);
    }
  }

  function formatCronHuman(cron: string): string {
    const parts = cron.split(' ');
    if (parts.length !== 5) return cron;
    const [min = '*', hour = '*', day = '*', month = '*', weekday = '*'] = parts;

    if (weekday !== '*' && day === '*' && month === '*') {
      const days = ['日', '一', '二', '三', '四', '五', '六'];
      return `每周${days[parseInt(weekday)] || weekday} ${hour}:${min.padStart(2, '0')}`;
    }
    if (day !== '*' && month !== '*') {
      return `${month}月${day}日 ${hour}:${min.padStart(2, '0')}`;
    }
    if (hour.startsWith('*/')) {
      return `每 ${hour.slice(2)} 小时`;
    }
    if (min.startsWith('*/')) {
      return `每 ${min.slice(2)} 分钟`;
    }
    return `每天 ${hour}:${min.padStart(2, '0')}`;
  }

  function formatTime(ts: number | null): string {
    if (!ts) return '--';
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    if (isToday) return time;
    return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' + time;
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-[var(--bg-panel)] text-[var(--text-primary)] pl-3">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-default)] shrink-0">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setView('agent')}
            className="text-[var(--text-placeholder)] hover:text-[var(--text-primary)] transition-colors"
          >
            <ArrowLeft size={20} strokeWidth={1.5} />
          </button>
          <span className="text-[16px] font-medium text-[var(--text-title)]">自动化任务</span>
        </div>
        <button
          onClick={() => {
            setEditingId(null);
            setShowForm(true);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] bg-[var(--accent-primary)] text-white rounded-lg hover:opacity-90 transition-opacity"
        >
          <Plus size={14} />
          新建
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {automations.length === 0 ? (
          <div className="text-center text-[var(--text-disabled)] py-12">
            <Clock size={40} className="mx-auto mb-3 opacity-50" />
            <p className="text-[14px]">暂无自动化任务</p>
            <p className="text-[12px] mt-1">点击"新建"创建定时任务</p>
          </div>
        ) : (
          <div className="space-y-3">
            {automations.map((auto) => (
              <div
                key={auto.id}
                className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-card)] p-4 hover:border-[var(--border-hover)] transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[14px] text-[var(--text-title)] truncate">
                        {auto.name}
                      </span>
                      <span
                        className={`text-[11px] px-1.5 py-0.5 rounded-full ${
                          auto.enabled
                            ? 'bg-green-500/10 text-green-500'
                            : 'bg-[var(--bg-base)] text-[var(--text-disabled)]'
                        }`}
                      >
                        {auto.enabled ? '启用' : '禁用'}
                      </span>
                      {auto.runOnce && (
                        <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-yellow-500/10 text-yellow-500">
                          单次
                        </span>
                      )}
                    </div>
                    <div className="text-[12px] text-[var(--text-muted)] mt-1">
                      {formatCronHuman(auto.cron)} · {auto.timezone}
                    </div>
                    <p className="text-[12px] text-[var(--text-secondary)] mt-1.5 truncate">
                      {auto.description}
                    </p>
                    <div className="flex items-center gap-4 mt-2 text-[11px] text-[var(--text-disabled)]">
                      <span className="flex items-center gap-1">
                        <FolderOpen size={12} />
                        {auto.projectCwd.split(/[/\\]/).pop() || auto.projectCwd}
                      </span>
                      <span>上次: {formatTime(auto.lastRunAt)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-0.5 ml-3">
                    <button
                      onClick={() => handleToggle(auto.id, !auto.enabled)}
                      className={`p-2 rounded-lg hover:bg-[var(--bg-hover)] transition-colors ${
                        auto.enabled
                          ? 'text-[var(--accent-primary)]'
                          : 'text-[var(--text-disabled)]'
                      }`}
                      title={auto.enabled ? '禁用' : '启用'}
                    >
                      <Power size={15} />
                    </button>
                    <button
                      onClick={() => handleRunOnce(auto.id)}
                      disabled={loading}
                      className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-colors disabled:opacity-50"
                      title="立即执行"
                    >
                      <Play size={15} />
                    </button>
                    <button
                      onClick={() => {
                        setEditingId(auto.id);
                        setShowForm(true);
                      }}
                      className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-colors"
                      title="编辑"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                        <path d="m15 5 4 4" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(auto.id)}
                      className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-disabled)] hover:text-red-500 transition-colors"
                      title="删除"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <AutomationForm
          automationId={editingId}
          defaultProjectCwd={workspace.rootPath}
          onClose={() => {
            setShowForm(false);
            setEditingId(null);
          }}
          onSaved={() => {
            setShowForm(false);
            setEditingId(null);
            loadAutomations();
          }}
        />
      )}
    </div>
  );
}
