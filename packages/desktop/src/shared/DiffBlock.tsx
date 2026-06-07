import { useMemo } from 'react';
import { parseUnifiedDiff } from '../lib/diff-parser';

interface DiffBlockProps {
  diff: string;
}

export default function DiffBlock({ diff }: DiffBlockProps) {
  const parsed = useMemo(() => parseUnifiedDiff(diff), [diff]);
  const lines = parsed.flatMap((f) => f.hunks.flatMap((h) => h.lines));

  return (
    <div className="rounded-md overflow-hidden border border-[var(--border-strong)]">
      <pre className="text-[12px] leading-[1.5] font-mono overflow-x-auto">
        {lines.map((line, idx) => {
          const { type, text } = line;
          let bgColor = 'bg-[var(--bg-code)]';
          let textColor = 'text-[var(--text-primary)]';

          if (type === 'add') {
            bgColor = 'bg-[var(--diff-add-bg)]';
            textColor = 'text-[var(--diff-add-text)]';
          } else if (type === 'remove') {
            bgColor = 'bg-[var(--diff-remove-bg)]';
            textColor = 'text-[var(--diff-remove-text)]';
          }

          return (
            <div key={idx} className={`${bgColor} ${textColor} px-2`}>
              {type === 'add' ? '+' : type === 'remove' ? '-' : ' '}
              {text}
            </div>
          );
        })}
      </pre>
    </div>
  );
}
