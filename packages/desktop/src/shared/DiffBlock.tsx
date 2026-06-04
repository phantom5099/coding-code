import { useMemo } from 'react';
import { parseUnifiedDiff } from '../lib/diff-parser';

interface DiffBlockProps {
  diff: string;
}

export default function DiffBlock({ diff }: DiffBlockProps) {
  const parsed = useMemo(() => parseUnifiedDiff(diff), [diff]);
  const lines = parsed.flatMap((f) => f.hunks.flatMap((h) => h.lines));

  return (
    <div className="rounded-md overflow-hidden border border-[#333]">
      <pre className="text-[12px] leading-[1.5] font-mono overflow-x-auto">
        {lines.map((line, idx) => {
          const { type, text } = line;
          let bgColor = 'bg-[#1e1e1e]';
          let textColor = 'text-[#d4d4d4]';

          if (type === 'add') {
            bgColor = 'bg-[#1a3a1a]';
            textColor = 'text-[#4ec9b0]';
          } else if (type === 'remove') {
            bgColor = 'bg-[#3a1a1a]';
            textColor = 'text-[#f44747]';
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
