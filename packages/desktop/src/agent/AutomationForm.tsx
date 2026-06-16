import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { useAgentStore, type Automation } from '../stores/agent.store';
import { createAutomation, updateAutomation } from '../lib/core-api';

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

export function AutomationForm({
  automationId,
  defaultProjectCwd,
  onClose,
  onSaved,
}: AutomationFormProps) {
  const automations = useAgentStore((s) => s.automations);
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
  const [sandbox, setSandbox] = useState<'readonly' | 'workspace-write'>(
    existing?.sandbox ?? 'workspace-write'
  );
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

  const inputClass =
    'w-full px-3 py-2 bg-[var(--bg-base)] border border-[var(--border-card)] rounded-lg text-[13px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)] transition-colors';
  const selectClass =
    'w-full px-3 py-2 bg-[var(--bg-base)] border border-[var(--border-card)] rounded-lg text-[13px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)] transition-colors';
  const labelClass = 'block text-[12px] text-[var(--text-muted)] mb-1.5';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[var(--bg-panel)] rounded-xl border border-[var(--border-default)] w-full max-w-md mx-4 max-h-[85vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-default)]">
          <h3 className="text-[14px] font-medium text-[var(--text-title)]">
            {automationId ? '编辑自动化任务' : '新建自动化任务'}
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-placeholder)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="text-[12px] text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          <div>
            <label className={labelClass}>名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              placeholder="每日报告"
            />
          </div>

          <div>
            <label className={labelClass}>任务描述 (发送给 Agent)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className={`${inputClass} resize-none`}
              placeholder="请检查项目状态并生成日报"
            />
          </div>

          <div>
            <label className={labelClass}>触发频率</label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as FrequencyType)}
              className={selectClass}
            >
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
              <option value="interval">间隔</option>
              <option value="once">执行一次</option>
              <option value="custom">自定义 cron</option>
            </select>
          </div>

          {frequency === 'daily' && (
            <div className="flex gap-3">
              <div className="flex-1">
                <label className={labelClass}>小时</label>
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={hour}
                  onChange={(e) => setHour(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="flex-1">
                <label className={labelClass}>分钟</label>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={minute}
                  onChange={(e) => setMinute(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
          )}

          {frequency === 'weekly' && (
            <>
              <div>
                <label className={labelClass}>星期</label>
                <select
                  value={weekday}
                  onChange={(e) => setWeekday(e.target.value)}
                  className={selectClass}
                >
                  {WEEKDAYS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className={labelClass}>小时</label>
                  <input
                    type="number"
                    min="0"
                    max="23"
                    value={hour}
                    onChange={(e) => setHour(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div className="flex-1">
                  <label className={labelClass}>分钟</label>
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={minute}
                    onChange={(e) => setMinute(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>
            </>
          )}

          {frequency === 'interval' && (
            <div className="flex gap-3">
              <div className="flex-1">
                <label className={labelClass}>间隔</label>
                <input
                  type="number"
                  min="1"
                  value={intervalValue}
                  onChange={(e) => setIntervalValue(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="flex-1">
                <label className={labelClass}>单位</label>
                <select
                  value={intervalUnit}
                  onChange={(e) => setIntervalUnit(e.target.value as 'hours' | 'minutes')}
                  className={selectClass}
                >
                  <option value="hours">小时</option>
                  <option value="minutes">分钟</option>
                </select>
              </div>
            </div>
          )}

          {frequency === 'once' && (
            <div className="flex gap-3">
              <div className="flex-1">
                <label className={labelClass}>小时</label>
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={hour}
                  onChange={(e) => setHour(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="flex-1">
                <label className={labelClass}>分钟</label>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={minute}
                  onChange={(e) => setMinute(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
          )}

          {frequency === 'custom' && (
            <div>
              <label className={labelClass}>Cron 表达式</label>
              <input
                type="text"
                value={customCron}
                onChange={(e) => setCustomCron(e.target.value)}
                className={`${inputClass} font-mono`}
                placeholder="0 9 * * *"
              />
              <p className="text-[11px] text-[var(--text-disabled)] mt-1.5">格式: 分 时 日 月 周</p>
            </div>
          )}

          <div>
            <label className={labelClass}>时区</label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className={selectClass}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>沙箱模式</label>
            <select
              value={sandbox}
              onChange={(e) => setSandbox(e.target.value as 'readonly' | 'workspace-write')}
              className={selectClass}
            >
              <option value="workspace-write">workspace-write (可读写)</option>
              <option value="readonly">readonly (只读)</option>
            </select>
          </div>

          {!automationId && (
            <div>
              <label className={labelClass}>项目路径</label>
              <input
                type="text"
                value={projectCwd}
                onChange={(e) => setProjectCwd(e.target.value)}
                className={`${inputClass} font-mono`}
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
              className="rounded border-[var(--border-card)]"
            />
            <label htmlFor="runOnce" className="text-[12px] text-[var(--text-muted)]">
              执行一次后自动删除
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border-default)]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-[13px] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors border border-[var(--border-card)]"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-[13px] bg-[var(--accent-primary)] text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
