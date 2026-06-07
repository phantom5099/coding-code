import { useState, useEffect } from 'react';
import Toggle from './Toggle';
import { listSkills, toggleSkill } from '../lib/core-api';

interface SkillEntry {
  name: string;
  description: string;
  disabled: boolean;
}

export default function SkillPanel() {
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const data = await listSkills();
      setSkills(data ?? []);
    } catch {
      setSkills([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggle = async (name: string, disabled: boolean) => {
    await toggleSkill(name, !disabled);
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
                <span className="text-[15px] text-[var(--text-title)] truncate block">{s.name}</span>
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
