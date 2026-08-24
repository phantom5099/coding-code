import { useState, useEffect } from 'react';
import { useWorkspaceStore } from '../stores/workspace.store';
import { listSkills } from '../lib/core-api';

interface SkillEntry {
  name: string;
  description: string;
  skillPath: string;
  source?: 'global' | 'project';
  hasProjectOverride?: boolean;
}

export default function SkillPanel({ global: isGlobal }: { global?: boolean }) {
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const cwd = isGlobal ? undefined : rootPath;

  useEffect(() => {
    setLoading(true);
    listSkills(cwd)
      .then((data) => setSkills(data ?? []))
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));
  }, [rootPath, isGlobal]);

  if (loading) return <div className="px-6 py-8 text-[14px] text-[var(--text-disabled)]">加载中…</div>;
  if (skills.length === 0) return <div className="px-6 py-8 text-[14px] text-[var(--text-disabled)] text-center">未找到 Skill</div>;

  return (
    <div className="px-6 py-5">
      <div className="space-y-3">
        {skills.map((skill) => (
          <div key={skill.name} className="px-4 py-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-card)]">
            <div className="flex items-center gap-2">
              <span className="text-[15px] text-[var(--text-title)] truncate">{skill.name}</span>
              {skill.source === 'global' && <span className="text-[11px] px-2 py-0.5 rounded bg-[var(--tag-info-bg)] text-[var(--tag-info-text)]">全局</span>}
              {skill.source === 'project' && <span className="text-[11px] px-2 py-0.5 rounded bg-[var(--tag-action-bg)] text-[var(--tag-action-text)]">项目</span>}
              {skill.hasProjectOverride && <span className="text-[11px] px-2 py-0.5 rounded bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]">覆盖全局</span>}
            </div>
            {skill.description && <div className="text-[13px] text-[var(--text-placeholder)] mt-1">{skill.description}</div>}
            <div className="text-[11px] text-[var(--text-disabled)] mt-1 truncate">{skill.skillPath}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
