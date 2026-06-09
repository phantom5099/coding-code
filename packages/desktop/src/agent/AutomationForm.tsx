import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { useGlobalStore, type Automation } from '../stores/global.store';
import { createAutomation, updateAutomation, listAutomations } from '../lib/core-api';

interface AutomationFormProps {
  automationId: string | null;
  defaultProjectCwd: string;
  onClose: () => void;
  onSaved: () => void;
}

type FrequencyType = 'daily' | 'weekly' | 'interval' | 'once' | 'custom';

const TIMEZONES = [
  'Asia/Shanghai',
  'Asia/Tokyo',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'UTC',
];

const WEEKDAYS = [
  { value: '1', label: '周一' },
  { value: '2', label: '周二' },
  { value: '3', label: '周三' },
  { value: '4', label: '周四' },
  { value: '5', label: '周五' },
  { value: '6', label: '周六' },
  { value: '0', label: '周日' },
];

export function AutomationForm({ automationId, defaultProjectCwd, onClose, onSaved }: AutomationFormProps) {
  const automations = useGlobalStore((s) => s.agent.automations);
  const existing = automationId ? automations.find((a: Automation) => a.id === automationId) : null;

  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [frequency, setFrequency] = useState<FrequencyType>('daily');
  const [hour, setHour] = useState('9');
  const [minute, setMinute] = useState('0');
  const [weekday, setWeekday] = useState('1');
  const [intervalValue, setIntervalValue] = useState('2');
  const [intervalUnit, setIntervalUnit] = useState<'hours' | 'minutes'>('hours');
  const [customCron, setCustomCron] = useState(existing?.cron ?? '');
  const [timezone, setTimezone] = useState(existing?.timezone ?? 'Asia/Shanghai');
  const [sandbox, setSandbox] = useState<'readonly' | 'workspace-write'>(existing?.sandbox ?? 'workspace-write');
  const [projectCwd, setProjectCwd] = useState(existing?.projectCwd ?? defaultProjectCwd);
  const [runOnce, setRunOnce] = useState(existing?.runOnce ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (existing) {
      parseCron(existing.cron);
    }
  }, []);

  function parseCron(cron: string) {
    const parts = cron.split(' ');
    if (parts.length !== 5) {
      setFrequency('custom');
      setCustomCron(cron);
      return;
    }
    const [min = '0', hr = '9', , , wd = '*'] = parts;
    setMinute(min);
    setHour(hr);

    if (wd !== '*' && !wd.includes(',')) {
      setFrequency('weekly');
      setWeekday(wd);
    } else if (hr.startsWith('*/')) {
      setFrequency('interval');
      setIntervalValue(hr.slice(2));
      setIntervalUnit('hours');
    } else if (min.startsWith('*/')) {
      setFrequency('interval');
      setIntervalValue(min.slice(2));
      setIntervalUnit('minutes');
    } else {
      setFrequency('daily');
    }
  }

  function buildCron(): string {
    switch (frequency) {
      case 'daily':
        return `${minute} ${hour} * * *`;
      case 'weekly':
        return `${minute} ${hour} * * ${weekday}`;
      case 'interval':
        if (intervalUnit === 'hours') {
          return `0 */${intervalValue} * * *`;
        }
        return `*/${intervalValue} * * * *`;
      case 'once':
        return `${minute} ${hour} * * *`;
      case 'custom':
        return customCron;
    }
  }

  function validateCron(cron: string): boolean {
    const parts = cron.split(' ');
    return parts.length === 5;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('请输入任务名称');
      return;
    }
    if (!description.trim()) {
      setError('请输入任务描述');
      return;
    }
    if (!projectCwd.trim()) {
      setError('请输入项目路径');
      return;
    }

    const cron = buildCron();
    if (!validateCron(cron)) {
      setError('无效的 cron 表达式');
      return;
    }

    setSaving(true);
    try {
      if (automationId) {
        await updateAutomation(automationId, {
          name,
          description,
          cron,
          timezone,
          sandbox,
          runOnce,
        });
      } else {
        await createAutomation({
          name,
          description,
          cron,
          timezone,
          sandbox,
          projectCwd,
          runOnce,
        });
      }
      onSaved();
    } catch (e: any) {
      setError(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#252525] rounded-lg border border-[#333] w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#333]">
          <h3 className="text-sm font-medium">{automationId ? '编辑自动化任务' : '新建自动化任务'}</h3>
          <button onClick={onClose} className="p-1 hover:bg-[#333] rounded transition-colors">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="text-xs text-red-400 bg-red-900/20 px-3 py-2 rounded">{error}</div>
          )}

          <div>
            <label className="block text-xs text-gray-400 mb-1">名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-[#1a1a1a] border border-[#333] rounded text-sm focus:outline-none focus:border-blue-500"
              placeholder="每日报告"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">任务描述 (发送给 Agent)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 bg-[#1a1a1a] border border-[#333] rounded text-sm focus:outline-none focus:border-blue-500 resize-none"
              placeholder="请检查项目状态并生成日报"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">触发频率</label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as FrequencyType)}
              className="w-full px-3 py-2 bg-[#1a1a1a] border border-[#333] rounded text-sm focus:outline-none focus:border-blue-500"
            >
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
              <option value="interval">间隔</option>
              <option value="once">执行一次</option>
              <option value="custom">自定义 cron</option>
            </select>
          </div>

          {frequency === 'daily' && (
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-xs text-gray-400 mb-1">小时</label>
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={hour}
                  onChange={(e) => setHour(e.target.value)}
                  className="w-full px-3 py-2 bg-[#1a1a1a] border border-[#333] rounded text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-400 mb-1">分钟</label>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={minute}
                  onChange={(e) => setMinute(e.target.value)}
                  className="w-full px-3 py-2 bg-[#1a1a1a] border border-[#333] rounded text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          )}

          {frequency === 'weekly' && (
            <>
              <div>
                <label className="block text-xs text-gray-400 mb-1">星期</label>
                <select
                  value={weekday}
                  onChange={(e) => setWeekday(e.target.value)}
                  className="w-full px-3 py-2 bg-[#1a1a1a] border border-[#333] rounded text-sm focus:outline-none focus:border-blue-500"
                >
                  {WEEKDAYS.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs text-gray-400 mb-1">小时</label>
                  <input
                    type="number"
                    min="0"
                    max="23"
                    value={hour}
                    onChange={(e) => setHour(e.target.value)}
                    className="w-full px-3 py-2 bg-[#1a1a1a] border border-[#333] rounded text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-gray-400 mb-1">分钟</label>
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={minute}
                    onChange={(e) => setMinute(e.target.value)}
                    className="w-full px-3 py-2 bg-[#1a1a1a] border border-[#333] rounded text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </>
          )}

          {frequency === 'interval' && (
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-xs text-gray-400 mb-1">间隔</label>
                <input
                  type="number"
                  min="1"
                  value={intervalValue}
                  onChange={(e) => setIntervalValue(e.target.value)}
                  className="w-full px-3 py-2 bg-[#1a1a1a] border border-[#333] rounded text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-400 mb-1">单位</label>
                <select
                  value={intervalUnit}
                  onChange={(e) => setIntervalUnit(e.target.value as 'hours' | 'minutes')}
                  className="w-full px-3 py-2 bg-[#1a1a1a] border border-[#333] rounded text-sm focus:outline-none focus:border-blue-500"
                >
                  <option value="hours">小时</option>
                  <option value="minutes">分钟</option>
                </select>
              </div>
            </div>
          )}

          {frequency === 'once' && (
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-xs text-gray-400 mb-1">小时</label>
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={hour}
                  onChange={(e) => setHour(e.target.value)}
                  className="w-full px-3 py-2 bg-[#1a1a1a] border border-[#333] rounded text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-400 mb-1">分钟</label>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={minute}
                  onChange={(e) => setMinute(e.target.value)}
                  className="w-full px-3 py-2 bg-[#1a1a1a] border border-[#333] rounded text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          )}

          {frequency === 'custom' && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Cron 表达式</label>
              <input
                type="text"
                value={customCron}
                onChange={(e) => setCustomCron(e.target.value)}
                className="w-full px-3 py-2 bg-[#1a1a1a] border border-[#333] rounded text-sm focus:outline-none focus:border-blue-500 font-mono"
                placeholder="0 9 * * *"
              />
              <p className="text-xs text-gray-500 mt-1">格式: 分 时 日 月 周</p>
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-400 mb-1">时区</label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full px-3 py-2 bg-[#1a1a1a] border border-[#333] rounded text-sm focus:outline-none focus:border-blue-500"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">沙箱模式</label>
            <select
              value={sandbox}
              onChange={(e) => setSandbox(e.target.value as 'readonly' | 'workspace-write')}
              className="w-full px-3 py-2 bg-[#1a1a1a] border border-[#333] rounded text-sm focus:outline-none focus:border-blue-500"
            >
              <option value="workspace-write">workspace-write (可读写)</option>
              <option value="readonly">readonly (只读)</option>
            </select>
          </div>

          {!automationId && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">项目路径</label>
              <input
                type="text"
                value={projectCwd}
                onChange={(e) => setProjectCwd(e.target.value)}
                className="w-full px-3 py-2 bg-[#1a1a1a] border border-[#333] rounded text-sm focus:outline-none focus:border-blue-500 font-mono"
                placeholder="/home/user/project"
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="runOnce"
              checked={runOnce}
              onChange={(e) => setRunOnce(e.target.checked)}
              className="rounded border-[#333]"
            />
            <label htmlFor="runOnce" className="text-xs text-gray-400">
              执行一次后自动删除
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm bg-[#333] hover:bg-[#444] rounded transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 rounded transition-colors disabled:opacity-50"
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
