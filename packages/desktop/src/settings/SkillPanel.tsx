import { useState, useEffect } from 'react';
import Toggle from './Toggle';
import { useGlobalStore } from '../stores/global.store';
import { listSkills, toggleSkill } from '../lib/core-api';

interface SkillEntry {
  name: string;
  description: string;
  disabled: boolean;
  source?: 'global' | 'project';
  hasProjectOverride?: boolean;
}

export default function SkillPanel({ global: isGlobal }: { global?: boolean }) {
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const rootPath = useGlobalStore((s) => s.workspace.rootPath);
  const cwd = isGlobal ? undefined : rootPath;

  const load = async () => {
    setLoading(true);
    try {
      const data = await listSkills(cwd);
      setSkills(data ?? []);
    } catch {
      setSkills([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [rootPath, isGlobal]);

  const toggle = async (name: string, disabled: boolean) => {
    await toggleSkill(name, !disabled, cwd);
    setSkills((prev) => prev.map((s) => (s.name === name ? { ...s, disabled } : s)));
  };

  if (loading) {
    return <div className="px-6 py-8 text-[14px] text-[var(--text-disabled)]">加载中…</div>;
  }

  return (
    <div className="px-6 py-5">
      {skills.length === 0 ? (
        <div className="text-[14px] text-[var(--text-disabled)] py-8 text-center leading-loose">
          未找到 Skill
          <br />
          <span className="text-[13px] text-[var(--text-disabled)]">
            在 .codingcode/skills/ 目录下创建 skill 文件夹以添加
          </span>
        </div>
      ) : (
        <div className="space-y-3">
          {skills.map((s) => (
            <div
              key={s.name}
              className="flex items-center gap-4 px-4 py-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-card)]"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[15px] text-[var(--text-title)] truncate">{s.name}</span>
                  {s.source === 'global' && (
                    <span className="text-[11px] px-2 py-0.5 rounded bg-[var(--tag-info-bg)] text-[var(--tag-info-text)]">
                      全局
                    </span>
                  )}
                  {s.source === 'project' && (
                    <span className="text-[11px] px-2 py-0.5 rounded bg-[var(--tag-action-bg)] text-[var(--tag-action-text)]">
                      项目
                    </span>
                  )}
                  {s.hasProjectOverride && (
                    <span className="text-[11px] px-2 py-0.5 rounded bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]">
                      覆盖全局
                    </span>
                  )}
                </div>
                {s.description && (
                  <div className="text-[13px] text-[var(--text-placeholder)] mt-1 truncate">{s.description}</div>
                )}
              </div>
              <Toggle checked={!s.disabled} onChange={(v) => toggle(s.name, !v)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
