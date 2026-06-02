import { useState } from 'react'
import type { Item } from '@shared/types'
import CodeBlock from './CodeBlock'
import DiffBlock from './DiffBlock'

interface ToolSummaryProps {
  toolCall: Item & { type: 'tool_call' }
  toolResult?: Item & { type: 'tool_result' }
}

function getFilePathFromArgs(args: object): string | null {
  const a = args as Record<string, unknown>
  return typeof a.path === 'string' ? a.path : typeof a.file_path === 'string' ? a.file_path : null
}

function getCommand(args: object): string | null {
  const a = args as Record<string, unknown>
  return typeof a.command === 'string' ? a.command : null
}

function getSearchQuery(args: object): string | null {
  const a = args as Record<string, unknown>
  return typeof a.query === 'string' ? a.query : typeof a.regex === 'string' ? a.regex : null
}

export function buildToolSummaryTitle(
  toolCall: Item & { type: 'tool_call' },
  toolResult?: Item & { type: 'tool_result' },
): { title: string; isError: boolean; isRejected: boolean } {
  const isFileWrite = toolCall.name === 'write_file' || toolCall.name === 'edit_file' || toolCall.name === 'apply_patch'
  const isReadFile = toolCall.name === 'read_file'
  const isShell = toolCall.name === 'shell' || toolCall.name === 'bash' || toolCall.name === 'execute_command'
  const isSearch = toolCall.name === 'search_files' || toolCall.name === 'grep_search'
  const isListDir = toolCall.name === 'list_dir'
  const isRejected = toolCall.status === 'rejected'

  if (isRejected) {
    return { title: `已拒绝 ${toolCall.name}`, isError: false, isRejected: true }
  }

  if (isFileWrite) {
    const path = toolResult?.filePath || getFilePathFromArgs(toolCall.args) || ''
    const created = !!toolResult?.insertions && !toolResult?.deletions
    return {
      title: path ? (created ? `成功创建 ${path}` : `成功编辑 ${path}`) : `${toolCall.name} 结果`,
      isError: false,
      isRejected: false,
    }
  }

  if (isReadFile) {
    const path = getFilePathFromArgs(toolCall.args)
    return {
      title: path ? `读取文件 ${path}` : '读取文件',
      isError: toolResult ? toolResult.exitCode !== undefined && toolResult.exitCode !== 0 : false,
      isRejected: false,
    }
  }

  if (isShell) {
    const cmd = getCommand(toolCall.args)
    return {
      title: cmd ? `执行命令 ${cmd}` : `执行命令 ${toolCall.name}`,
      isError: toolResult ? toolResult.exitCode !== undefined && toolResult.exitCode !== 0 : false,
      isRejected: false,
    }
  }

  if (isSearch) {
    const query = getSearchQuery(toolCall.args)
    return {
      title: query ? `搜索 "${query}"` : '搜索文件',
      isError: toolResult ? toolResult.exitCode !== undefined && toolResult.exitCode !== 0 : false,
      isRejected: false,
    }
  }

  if (isListDir) {
    const path = getFilePathFromArgs(toolCall.args)
    return {
      title: path ? `列出目录 ${path}` : '列出目录',
      isError: toolResult ? toolResult.exitCode !== undefined && toolResult.exitCode !== 0 : false,
      isRejected: false,
    }
  }

  return {
    title: `${toolCall.name} 结果`,
    isError: toolResult ? toolResult.exitCode !== undefined && toolResult.exitCode !== 0 : false,
    isRejected: false,
  }
}

export default function ToolSummary({ toolCall, toolResult }: ToolSummaryProps) {
  const [open, setOpen] = useState(false)
  const isFileTool = toolCall.name === 'write_file' || toolCall.name === 'edit_file' || toolCall.name === 'apply_patch'
  const { title, isError, isRejected } = buildToolSummaryTitle(toolCall, toolResult)

  const titleColor = isRejected
    ? 'text-[#666] line-through'
    : isError
      ? 'text-[#f44747]'
      : 'text-[#dcdcaa]'

  const hasContent = !!(toolResult?.diff || toolResult?.output)

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[13px] hover:opacity-80 transition-opacity"
      >
        <span className={`transition-transform text-[10px] text-[#555] ${open ? 'rotate-90' : ''}`}>▶</span>
        <span className={`font-mono ${titleColor}`}>{title}</span>
        {isFileTool && toolResult && (toolResult.insertions || toolResult.deletions) && (
          <span className="text-[#555] text-xs">
            {toolResult.insertions ? `+${toolResult.insertions}` : ''}
            {toolResult.deletions ? ` -${toolResult.deletions}` : ''}
          </span>
        )}
      </button>
      {open && hasContent && (
        <div className="mt-1.5">
          {isFileTool && toolResult?.diff ? (
            <DiffBlock diff={toolResult.diff} />
          ) : toolResult?.output ? (
            <CodeBlock code={toolResult.output.slice(0, 4000)} />
          ) : null}
        </div>
      )}
    </div>
  )
}
