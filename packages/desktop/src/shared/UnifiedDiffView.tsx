import { useState, useMemo } from 'react';
import { parseUnifiedDiff } from '../lib/diff-parser';

interface UnifiedDiffViewProps {
  diff: string;
}

function DiffLineView({
  oldLineNum,
  newLineNum,
  type,
  text,
}: {
  oldLineNum: number | null;
  newLineNum: number | null;
  type: 'context' | 'add' | 'remove';
  text: string;
}) {
  const borderColor =
    type === 'add'
      ? 'border-l-[var(--diff-add-border)]'
      : type === 'remove'
        ? 'border-l-[var(--diff-remove-border)]'
        : 'border-l-transparent';
  const bgColor =
    type === 'add'
      ? 'bg-[var(--diff-add-bg)]'
      : type === 'remove'
        ? 'bg-[var(--diff-remove-bg)]'
        : 'bg-transparent';
  const textColor =
    type === 'add'
      ? 'text-[var(--diff-add-text)]'
      : type === 'remove'
        ? 'text-[var(--diff-remove-text)]'
        : 'text-[var(--text-secondary)]';

  return (
    <div
      className={`flex font-mono text-[12px] leading-[1.6] ${bgColor} border-l-[3px] ${borderColor}`}
    >
      <div className="w-10 shrink-0 text-right pr-2 text-[var(--diff-line-num)] select-none tabular-nums">
        {oldLineNum ?? ''}
      </div>
      <div className="w-10 shrink-0 text-right pr-2 text-[var(--diff-line-num)] select-none tabular-nums border-r border-[var(--diff-line-num-border)]">
        {newLineNum ?? ''}
      </div>
      <div className={`flex-1 pl-3 whitespace-pre ${textColor} overflow-x-auto`}>
        {text || '\u00A0'}
      </div>
    </div>
  );
}

function DiffFileView({ file }: { file: import('../lib/diff-parser').ParsedDiffFile }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="mb-2 last:mb-0">
      {/* File header */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-[var(--bg-code)] hover:bg-[var(--bg-hover)] text-[12px] text-[var(--text-primary)] rounded-t border-b border-[var(--border-card)] text-left"
      >
        <span
          className={`transition-transform text-[10px] text-[var(--text-muted)] ${collapsed ? '' : 'rotate-90'}`}
        >
          ▶
        </span>
        <span className="font-mono">{file.fileName}</span>
      </button>

      {!collapsed && (
        <div className="border border-[var(--border-card)] rounded-b overflow-hidden">
          {file.hunks.length === 0 && (
            <div className="px-3 py-2 text-[12px] text-[var(--text-muted)]">无差异</div>
          )}
          {file.hunks.map((hunk, hi) => (
            <div key={hi}>
              {/* Hunk context line (@@ ...) */}
              <div className="flex items-center gap-2 px-3 py-1 bg-[var(--bg-code)] text-[var(--diff-line-num)] text-[11px] font-mono border-y border-[var(--diff-line-num-border)]">
                <span>@@</span>
                <span className="text-[var(--diff-hunk-header)]">
                  -{hunk.oldStart},{hunk.oldLen} +{hunk.newStart},{hunk.newLen}
                </span>
                <span>@@</span>
              </div>
              {hunk.lines.map((line, li) => (
                <DiffLineView
                  key={`${hi}-${li}`}
                  oldLineNum={line.oldLineNum}
                  newLineNum={line.newLineNum}
                  type={line.type}
                  text={line.text}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function UnifiedDiffView({ diff }: UnifiedDiffViewProps) {
  const parsed = useMemo(() => parseUnifiedDiff(diff), [diff]);

  if (parsed.length === 0) {
    return <div className="text-[12px] text-[var(--text-muted)] px-3 py-2">无差异</div>;
  }

  return (
    <div className="w-full">
      {parsed.map((file) => (
        <DiffFileView key={file.fileName} file={file} />
      ))}
    </div>
  );
}
