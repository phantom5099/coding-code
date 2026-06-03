import { useState } from 'react';
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
      ? 'border-l-[#2a6a2a]'
      : type === 'remove'
        ? 'border-l-[#6a2a2a]'
        : 'border-l-transparent';
  const bgColor =
    type === 'add' ? 'bg-[#1a2f1a]' : type === 'remove' ? 'bg-[#2f1a1a]' : 'bg-transparent';
  const textColor =
    type === 'add' ? 'text-[#7ee787]' : type === 'remove' ? 'text-[#ffa198]' : 'text-[#aaa]';

  return (
    <div
      className={`flex font-mono text-[12px] leading-[1.6] ${bgColor} border-l-[3px] ${borderColor}`}
    >
      <div className="w-10 shrink-0 text-right pr-2 text-[#555] select-none tabular-nums">
        {oldLineNum ?? ''}
      </div>
      <div className="w-10 shrink-0 text-right pr-2 text-[#555] select-none tabular-nums border-r border-[#222]">
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
        className="w-full flex items-center gap-2 px-3 py-2 bg-[#1e1e1e] hover:bg-[#252525] text-[12px] text-[#ccc] rounded-t border-b border-[#2a2a2a] text-left"
      >
        <span
          className={`transition-transform text-[10px] text-[#666] ${collapsed ? '' : 'rotate-90'}`}
        >
          ▶
        </span>
        <span className="font-mono">{file.fileName}</span>
      </button>

      {!collapsed && (
        <div className="border border-[#2a2a2a] rounded-b overflow-hidden">
          {file.hunks.length === 0 && (
            <div className="px-3 py-2 text-[12px] text-[#555]">无差异</div>
          )}
          {file.hunks.map((hunk, hi) => (
            <div key={hi}>
              {/* Hunk context line (@@ ...) */}
              <div className="flex items-center gap-2 px-3 py-1 bg-[#1e1e1e] text-[#555] text-[11px] font-mono border-y border-[#222]">
                <span>@@</span>
                <span className="text-[#888]">
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
  const parsed = parseUnifiedDiff(diff);

  if (parsed.length === 0) {
    return <div className="text-[12px] text-[#555] px-3 py-2">无差异</div>;
  }

  return (
    <div className="w-full">
      {parsed.map((file) => (
        <DiffFileView key={file.fileName} file={file} />
      ))}
    </div>
  );
}
