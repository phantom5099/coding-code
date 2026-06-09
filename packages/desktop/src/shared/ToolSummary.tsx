import { useState, useMemo } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import type { Item } from '@shared/types';
import { buildToolDiff } from '../lib/diff-compute';
import CodeBlock from './CodeBlock';
import DiffBlock from './DiffBlock';

interface ToolSummaryProps {
  toolCall: Item & { type: 'tool_call' };
  toolResult?: Item & { type: 'tool_result' };
}

function getFilePathFromArgs(args: object): string | null {
  const a = args as Record<string, unknown>;
  return typeof a.path === 'string' ? a.path : typeof a.file_path === 'string' ? a.file_path : null;
}

function getCommand(args: object): string | null {
  const a = args as Record<string, unknown>;
  return typeof a.command === 'string' ? a.command : null;
}

function getSearchQuery(args: object): string | null {
  const a = args as Record<string, unknown>;
  return typeof a.query === 'string' ? a.query : typeof a.regex === 'string' ? a.regex : null;
}

export function buildToolSummaryTitle(
  toolCall: Item & { type: 'tool_call' },
  toolResult?: Item & { type: 'tool_result' }
): { title: string; isError: boolean; isRejected: boolean } {
  const isFileWrite = toolCall.name === 'write_file' || toolCall.name === 'edit_file';
  const isReadFile = toolCall.name === 'read_file';
  const isShell =
    toolCall.name === 'shell' || toolCall.name === 'bash' || toolCall.name === 'execute_command';
  const isSearch = toolCall.name === 'search_files' || toolCall.name === 'grep_search';
  const isListDir = toolCall.name === 'list_dir';
  const isRejected = toolCall.status === 'rejected';

  if (isRejected) {
    return { title: `已拒绝 ${toolCall.name}`, isError: false, isRejected: true };
  }

  if (isFileWrite) {
    const path = toolResult?.filePath || getFilePathFromArgs(toolCall.args) || '';
    if (toolCall.name === 'write_file') {
      return { title: path ? `写入文件 ${path}` : '写入文件', isError: false, isRejected: false };
    }
    if (toolCall.name === 'edit_file') {
      return { title: path ? `编辑文件 ${path}` : '编辑文件', isError: false, isRejected: false };
    }
  }

  if (isReadFile) {
    const path = getFilePathFromArgs(toolCall.args);
    return {
      title: path ? `读取文件 ${path}` : '读取文件',
      isError: toolResult ? toolResult.exitCode !== undefined && toolResult.exitCode !== 0 : false,
      isRejected: false,
    };
  }

  if (isShell) {
    const cmd = getCommand(toolCall.args);
    return {
      title: cmd ? `执行命令 ${cmd}` : `执行命令 ${toolCall.name}`,
      isError: toolResult ? toolResult.exitCode !== undefined && toolResult.exitCode !== 0 : false,
      isRejected: false,
    };
  }

  if (isSearch) {
    const query = getSearchQuery(toolCall.args);
    return {
      title: query ? `搜索 "${query}"` : '搜索文件',
      isError: toolResult ? toolResult.exitCode !== undefined && toolResult.exitCode !== 0 : false,
      isRejected: false,
    };
  }

  if (isListDir) {
    const path = getFilePathFromArgs(toolCall.args);
    return {
      title: path ? `列出目录 ${path}` : '列出目录',
      isError: toolResult ? toolResult.exitCode !== undefined && toolResult.exitCode !== 0 : false,
      isRejected: false,
    };
  }

  return {
    title: `${toolCall.name} 结果`,
    isError: toolResult ? toolResult.exitCode !== undefined && toolResult.exitCode !== 0 : false,
    isRejected: false,
  };
}

export default function ToolSummary({ toolCall, toolResult }: ToolSummaryProps) {
  const [open, setOpen] = useState(false);
  const isFileTool = toolCall.name === 'write_file' || toolCall.name === 'edit_file';

  const computedResult = useMemo(() => {
    if (!toolResult || !isFileTool) return toolResult;
    if ((toolResult as any).diff) return toolResult;
    return buildToolDiff(toolResult as any, toolCall as any) as any;
  }, [toolResult, toolCall, isFileTool]);

  const effectiveResult = computedResult ?? toolResult;
  const { title, isError, isRejected } = buildToolSummaryTitle(toolCall, effectiveResult);

  const titleColor = isRejected
    ? 'text-[var(--text-muted)] line-through'
    : isError
      ? 'text-[var(--accent-danger)]'
      : 'text-[var(--syntax-function)]';

  const hasContent = !!(effectiveResult?.diff || effectiveResult?.output);

  return (
    <div className="pb-1.5 pl-8">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-[var(--border-card)] hover:bg-[var(--border-hover)] transition-colors text-[13px]"
      >
        {open ? (
          <ChevronDown className={`w-3.5 h-3.5 ${titleColor}`} />
        ) : (
          <ChevronRight className={`w-3.5 h-3.5 ${titleColor}`} />
        )}
        <span className={`font-mono ${titleColor}`}>{title}</span>
        {isFileTool &&
          effectiveResult &&
          (effectiveResult.insertions || effectiveResult.deletions) && (
            <span className="text-[var(--text-muted)] text-xs">
              {effectiveResult.insertions ? `+${effectiveResult.insertions}` : ''}
              {effectiveResult.deletions ? ` -${effectiveResult.deletions}` : ''}
            </span>
          )}
      </button>
      {open && hasContent && (
        <div className="pt-1.5">
          {isFileTool && effectiveResult?.diff ? (
            <DiffBlock diff={effectiveResult.diff} />
          ) : effectiveResult?.output ? (
            <CodeBlock code={effectiveResult.output.slice(0, 4000)} />
          ) : null}
        </div>
      )}
    </div>
  );
}
