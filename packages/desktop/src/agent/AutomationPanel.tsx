import { useEffect, useState } from 'react';
import { Plus, Play, Trash2, Power, Clock, FolderOpen } from 'lucide-react';
import { useGlobalStore, type Automation } from '../stores/global.store';
import { listAutomations, deleteAutomation, updateAutomation, runAutomationOnce } from '../lib/core-api';
import { AutomationForm } from './AutomationForm';

export function AutomationPanel() {
  const automations = useGlobalStore((s) => s.agent.automations);
  const setAutomations = useGlobalStore((s) => s.setAutomations);
  const workspace = useGlobalStore((s) => s.workspace);
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
    <div className="flex flex-col h-full bg-[#1a1a1a] text-gray-200">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#333]">
        <h2 className="text-sm font-medium">自动化任务</h2>
        <button
          onClick={() => {
            setEditingId(null);
            setShowForm(true);
          }}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded transition-colors"
        >
          <Plus size={14} />
          新建
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {automations.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <Clock size={32} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">暂无自动化任务</p>
            <p className="text-xs mt-1">点击"新建"创建定时任务</p>
          </div>
        ) : (
          automations.map((auto) => (
            <div
              key={auto.id}
              className="bg-[#252525] rounded-lg border border-[#333] p-3 hover:border-[#444] transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{auto.name}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      auto.enabled ? 'bg-green-900/50 text-green-400' : 'bg-gray-700 text-gray-400'
                    }`}>
                      {auto.enabled ? '启用' : '禁用'}
                    </span>
                    {auto.runOnce && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-900/50 text-yellow-400">
                        单次
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {formatCronHuman(auto.cron)} · {auto.timezone}
                  </div>
                  <p className="text-xs text-gray-400 mt-1 truncate">{auto.description}</p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <FolderOpen size={12} />
                      {auto.projectCwd.split(/[/\\]/).pop() || auto.projectCwd}
                    </span>
                    <span>上次: {formatTime(auto.lastRunAt)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-1 ml-2">
                  <button
                    onClick={() => handleToggle(auto.id, !auto.enabled)}
                    className={`p-1.5 rounded hover:bg-[#333] transition-colors ${
                      auto.enabled ? 'text-green-400' : 'text-gray-500'
                    }`}
                    title={auto.enabled ? '禁用' : '启用'}
                  >
                    <Power size={14} />
                  </button>
                  <button
                    onClick={() => handleRunOnce(auto.id)}
                    disabled={loading}
                    className="p-1.5 rounded hover:bg-[#333] text-blue-400 transition-colors disabled:opacity-50"
                    title="立即执行"
                  >
                    <Play size={14} />
                  </button>
                  <button
                    onClick={() => {
                      setEditingId(auto.id);
                      setShowForm(true);
                    }}
                    className="p-1.5 rounded hover:bg-[#333] text-gray-400 transition-colors"
                    title="编辑"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                      <path d="m15 5 4 4"/>
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDelete(auto.id)}
                    className="p-1.5 rounded hover:bg-[#333] text-red-400 transition-colors"
                    title="删除"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))
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
