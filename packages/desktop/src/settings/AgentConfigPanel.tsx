import { useState, useEffect } from 'react';
import { useGlobalStore } from '../stores/global.store';
import { getAgentConfig, setAgentConfig, setCompactionModel } from '../lib/core-api';

const inputCls =
  'w-[120px] bg-[var(--bg-hover)] border border-[var(--border-hover)] text-[var(--text-title)] px-3 py-2 rounded text-[13px] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]';

const selectCls =
  'w-[200px] bg-[var(--bg-hover)] border border-[var(--border-hover)] text-[var(--text-title)] px-3 py-2 rounded text-[13px] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]';

export default function AgentConfigPanel() {
  const models = useGlobalStore((s) => s.agent.models);

  const [maxSteps, setMaxSteps] = useState(200);
  const [maxStopContinuations, setMaxStopContinuations] = useState(2);
  const [compactionModel, setCompactionModelState] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const cfg = await getAgentConfig();
        setMaxSteps(cfg.maxSteps);
        setMaxStopContinuations(cfg.maxStopContinuations);
      } catch {
        // use defaults
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleMaxSteps = async (val: number) => {
    setMaxSteps(val);
    try {
      await setAgentConfig({ maxSteps: val });
    } catch {
      // revert on error by reloading
    }
  };

  const handleMaxStopContinuations = async (val: number) => {
    setMaxStopContinuations(val);
    try {
      await setAgentConfig({ maxStopContinuations: val });
    } catch {
      // revert on error
    }
  };

  const handleCompactionModel = async (val: string) => {
    setCompactionModelState(val);
    try {
      await setCompactionModel(val);
    } catch {
      // revert on error
    }
  };

  const groups: Record<string, typeof models> = {};
  for (const m of models) {
    if (!groups[m.provider]) groups[m.provider] = [];
    groups[m.provider]!.push(m);
  }

  if (loading) {
    return <div className="px-6 py-8 text-[14px] text-[var(--text-disabled)]">加载中…</div>;
  }

  return (
    <div className="px-6 py-5">
      <div className="text-[14px] text-[var(--text-title)] mb-3">执行配置</div>
      <div className="space-y-2">
        <div className="px-4 py-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-card)]">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[14px] text-[var(--text-title)]">最大执行步数</div>
              <div className="text-[12px] text-[var(--text-placeholder)] mt-0.5">
                Agent 在自动停止前最多执行的对话轮数
              </div>
            </div>
            <input
              type="number"
              min={1}
              max={9999}
              value={maxSteps}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v > 0) handleMaxSteps(v);
              }}
              className={inputCls}
            />
          </div>
        </div>

        <div className="px-4 py-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-card)]">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[14px] text-[var(--text-title)]">最大停止续行次数</div>
              <div className="text-[12px] text-[var(--text-placeholder)] mt-0.5">
                stop 钩子判定"继续执行"的最大次数，超出则强制终止
              </div>
            </div>
            <input
              type="number"
              min={0}
              max={99}
              value={maxStopContinuations}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v >= 0) handleMaxStopContinuations(v);
              }}
              className={inputCls}
            />
          </div>
        </div>

        <div className="px-4 py-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-card)]">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[14px] text-[var(--text-title)]">上下文压缩模型</div>
              <div className="text-[12px] text-[var(--text-placeholder)] mt-0.5">
                用于压缩对话上下文的模型，空则使用主对话模型
              </div>
            </div>
            <select
              value={compactionModel}
              onChange={(e) => handleCompactionModel(e.target.value)}
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
    </div>
  );
}
