import { useState, useEffect } from 'react';
import { useAgentStore } from '../stores/agent.store';
import Toggle from './Toggle';
import { getMemoryConfig, setMemoryEnabled, setMemoryModel } from '../lib/core-api';

interface MemoryConfig {
  enabled: boolean;
  model: string;
}

export default function MemoryPanel() {
  const models = useAgentStore((s) => s.models);
  const [config, setConfig] = useState<MemoryConfig>({
    enabled: false,
    model: '',
  });
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getMemoryConfig();
      setConfig({
        enabled: data.enabled ?? false,
        model: data.model ?? '',
      });
    } catch {
      setConfig({ enabled: false, model: '' });
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

  const selectCls =
    'w-[200px] bg-[var(--bg-hover)] border border-[var(--border-hover)] text-[var(--text-title)] px-3 py-2 rounded text-[13px] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]';

  if (loading) {
    return <div className="px-6 py-8 text-[14px] text-[var(--text-disabled)]">加载中…</div>;
  }

  return (
    <div className="px-6 py-5">
      <div className="px-4 py-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-card)] mb-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[14px] text-[var(--text-title)]">记忆模式</div>
            <div className="text-[12px] text-[var(--text-placeholder)] mt-0.5">
              启用后自动从会话中提取长期记忆
            </div>
          </div>
          <Toggle checked={config.enabled} onChange={toggleEnabled} />
        </div>
      </div>

      <div className="px-4 py-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-card)]">
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
    </div>
  );
}
