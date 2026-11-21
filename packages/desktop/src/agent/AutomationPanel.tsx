import { useEffect, useState } from 'react';
import { Clock3, FolderOpen, Play, Plus, Power, Trash2, Pencil } from 'lucide-react';
import { useAgentStore } from '../stores/agent.store';
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
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const automations = useAgentStore((s) => s.automations);
  const setAutomations = useAgentStore((s) => s.setAutomations);
  const workspace = useWorkspaceStore();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void loadAutomations();
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
    if (hour.startsWith('*/')) return `每 ${hour.slice(2)} 小时`;
    if (min.startsWith('*/')) return `每 ${min.slice(2)} 分钟`;
    return `每天 ${hour}:${min.padStart(2, '0')}`;
  }

  function formatTime(ts: number | null): string {
    if (!ts) return '--';
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    if (isToday) return time;
    return `${d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })} ${time}`;
  }

  const openNewForm = () => {
    setEditingId(null);
    setShowForm(true);
  };

  return (
    <div className="cc-automation-layout flex min-w-0 flex-1 overflow-hidden bg-[var(--bg-base)]">
      {!sidebarCollapsed && (
        <aside className="cc-automation-sidebar flex w-[272px] shrink-0 flex-col border-r border-[var(--border-default)] bg-[var(--bg-sidebar)]">
          <div className="cc-automation-sidebar-header px-5 pb-4 pt-5">
            <div className="flex items-center justify-between">
              <h1 className="text-[18px] font-semibold tracking-[-0.02em] text-[var(--text-title)]">自动化</h1>
            </div>
            <button type="button" onClick={openNewForm} className="cc-automation-new-button mt-5 flex w-full items-center gap-2 rounded-xl px-3.5 py-2.5 text-[14px] font-medium">
              <Plus size={17} strokeWidth={1.8} />
              <span>新建任务</span>
            </button>
          </div>
          <div className="mx-5 border-t border-[var(--border-divider)]" />
          <div className="flex items-center justify-between px-5 py-4 text-[12px] text-[var(--text-muted)]">
            <span>计划任务</span>
            <span>{automations.length}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
            {automations.map((auto) => (
              <button key={auto.id} type="button" onClick={() => { setEditingId(auto.id); setShowForm(true); }} className="cc-automation-sidebar-row flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left">
                <Clock3 size={15} className={auto.enabled ? 'text-[var(--accent-primary)]' : 'text-[var(--text-disabled)]'} />
                <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-secondary)]">{auto.name}</span>
                <span className={`h-1.5 w-1.5 rounded-full ${auto.enabled ? 'bg-[var(--accent-success)]' : 'bg-[var(--text-disabled)]'}`} />
              </button>
            ))}
            {automations.length === 0 && <div className="px-3 py-2 text-[13px] text-[var(--text-disabled)]">暂无计划任务</div>}
          </div>
        </aside>
      )}

      <main className="cc-automation-main min-w-0 flex-1 overflow-y-auto">
        <div className="cc-automation-main-header flex items-center justify-between border-b border-[var(--border-default)] px-8 py-5">
          <div>
            <div className="text-[13px] text-[var(--text-muted)]">自动化</div>
            <h2 className="mt-1 text-[20px] font-semibold tracking-[-0.02em] text-[var(--text-title)]">计划任务</h2>
          </div>
          <button type="button" onClick={openNewForm} className="cc-automation-header-action flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium">
            <Plus size={15} /> 新建
          </button>
        </div>

        <div className="cc-automation-main-content p-8">
          {automations.length === 0 ? (
            <div className="cc-automation-empty flex min-h-[420px] flex-col items-center justify-center text-center">
              <div className="cc-automation-empty-icon flex h-14 w-14 items-center justify-center rounded-2xl">
                <Clock3 size={30} strokeWidth={1.5} />
              </div>
              <h3 className="mt-5 text-[18px] font-medium text-[var(--text-title)]">暂无自动化任务</h3>
              <p className="mt-2 max-w-[360px] text-[13px] leading-6 text-[var(--text-muted)]">创建一个计划任务，让 Coding Code 在指定时间自动执行工作。</p>
            </div>
          ) : (
            <div className="mx-auto max-w-[900px] space-y-3">
              {automations.map((auto) => (
                <div key={auto.id} className="cc-automation-card rounded-2xl border p-5">
                  <div className="flex items-start justify-between gap-6">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[15px] font-medium text-[var(--text-title)]">{auto.name}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] ${auto.enabled ? 'cc-automation-status-on' : 'cc-automation-status-off'}`}>{auto.enabled ? '启用' : '禁用'}</span>
                        {auto.runOnce && <span className="cc-automation-status-on rounded-full px-2 py-0.5 text-[11px]">单次</span>}
                      </div>
                      <div className="mt-2 text-[13px] text-[var(--text-secondary)]">{formatCronHuman(auto.cron)} · {auto.timezone}</div>
                      <p className="mt-2 truncate text-[13px] text-[var(--text-muted)]">{auto.description}</p>
                      <div className="mt-3 flex items-center gap-4 text-[12px] text-[var(--text-disabled)]">
                        <span className="flex items-center gap-1.5"><FolderOpen size={13} />{auto.projectCwd.split(/[/\\]/).pop() || auto.projectCwd}</span>
                        <span>上次执行 {formatTime(auto.lastRunAt)}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button type="button" onClick={() => handleToggle(auto.id, !auto.enabled)} className="cc-automation-icon-button" title={auto.enabled ? '禁用' : '启用'}><Power size={15} /></button>
                      <button type="button" onClick={() => handleRunOnce(auto.id)} disabled={loading} className="cc-automation-icon-button disabled:opacity-50" title="立即执行"><Play size={15} /></button>
                      <button type="button" onClick={() => { setEditingId(auto.id); setShowForm(true); }} className="cc-automation-icon-button" title="编辑"><Pencil size={15} /></button>
                      <button type="button" onClick={() => handleDelete(auto.id)} className="cc-automation-icon-button cc-automation-delete" title="删除"><Trash2 size={15} /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {showForm && (
        <AutomationForm
          automationId={editingId}
          initialProjectCwd={workspace.rootPath}
          onClose={() => { setShowForm(false); setEditingId(null); }}
          onSaved={() => { setShowForm(false); setEditingId(null); void loadAutomations(); }}
        />
      )}
    </div>
  );
}
