import { describe, it, expect } from 'vitest'
import { buildToolSummaryTitle } from '../src/shared/ToolSummary'
import type { Item } from '../shared/types'

type ToolCallItem = Extract<Item, { type: 'tool_call' }>

function makeToolCall(name: string, status: ToolCallItem['status'], args?: object): ToolCallItem {
  return { id: 'tc-' + name, type: 'tool_call', name, args: args ?? {}, status }
}

type ToolResultItem = Extract<Item, { type: 'tool_result' }>

function makeToolResult(
  name: string,
  opts?: Partial<ToolResultItem>,
): ToolResultItem {
  return {
    id: 'tr-' + name,
    type: 'tool_result',
    callId: 'tc-' + name,
    name,
    output: opts?.output ?? 'ok',
    exitCode: opts?.exitCode ?? 0,
    filePath: opts?.filePath,
    diff: opts?.diff,
    insertions: opts?.insertions,
    deletions: opts?.deletions,
  }
}

describe('buildToolSummaryTitle', () => {
  it('returns rejected title for rejected tool_call', () => {
    const call = makeToolCall('bash', 'rejected')
    const result = buildToolSummaryTitle(call)
    expect(result.title).toBe('已拒绝 bash')
    expect(result.isRejected).toBe(true)
    expect(result.isError).toBe(false)
  })

  it('returns "写入文件 {path}" for write_file', () => {
    const call = makeToolCall('write_file', 'approved')
    const result = makeToolResult('write_file', { filePath: 'foo.ts', insertions: 5, deletions: 0 })
    const title = buildToolSummaryTitle(call, result)
    expect(title.title).toBe('写入文件 foo.ts')
    expect(title.isRejected).toBe(false)
    expect(title.isError).toBe(false)
  })

  it('returns "编辑文件 {path}" for edit_file', () => {
    const call = makeToolCall('edit_file', 'approved')
    const result = makeToolResult('edit_file', { filePath: 'bar.ts', insertions: 3, deletions: 2 })
    const title = buildToolSummaryTitle(call, result)
    expect(title.title).toBe('编辑文件 bar.ts')
  })

  it('returns command title for shell with command in args', () => {
    const call = makeToolCall('shell', 'approved', { command: 'npm test' })
    const title = buildToolSummaryTitle(call)
    expect(title.title).toBe('执行命令 npm test')
  })

  it('returns generic command title for shell without command arg', () => {
    const call = makeToolCall('shell', 'approved', {})
    const title = buildToolSummaryTitle(call)
    expect(title.title).toBe('执行命令 shell')
  })

  it('marks shell as error when exitCode is non-zero', () => {
    const call = makeToolCall('shell', 'approved', { command: 'npm test' })
    const result = makeToolResult('shell', { exitCode: 1, output: 'fail' })
    const title = buildToolSummaryTitle(call, result)
    expect(title.title).toBe('执行命令 npm test')
    expect(title.isError).toBe(true)
  })

  it('returns generic result title for unknown tools', () => {
    const call = makeToolCall('search', 'approved')
    const title = buildToolSummaryTitle(call)
    expect(title.title).toBe('search 结果')
  })

  it('marks generic result as error when exitCode is non-zero', () => {
    const call = makeToolCall('search', 'approved')
    const result = makeToolResult('search', { exitCode: 2, output: 'error' })
    const title = buildToolSummaryTitle(call, result)
    expect(title.isError).toBe(true)
  })

  it('extracts path from args.path for write_file without toolResult', () => {
    const call = makeToolCall('write_file', 'approved', { path: 'src/foo.ts' })
    const title = buildToolSummaryTitle(call)
    expect(title.title).toBe('写入文件 src/foo.ts')
  })

  it('extracts path from args.file_path for edit_file without toolResult', () => {
    const call = makeToolCall('edit_file', 'approved', { file_path: 'src/bar.ts' })
    const title = buildToolSummaryTitle(call)
    expect(title.title).toBe('编辑文件 src/bar.ts')
  })

  it('prefers toolResult.filePath over args.path', () => {
    const call = makeToolCall('write_file', 'approved', { path: 'args.ts' })
    const result = makeToolResult('write_file', { filePath: 'result.ts' })
    const title = buildToolSummaryTitle(call, result)
    expect(title.title).toBe('写入文件 result.ts')
  })

  it('returns "读取文件 {path}" for read_file with path arg', () => {
    const call = makeToolCall('read_file', 'approved', { path: 'src/app.ts' })
    const title = buildToolSummaryTitle(call)
    expect(title.title).toBe('读取文件 src/app.ts')
  })

  it('returns "读取文件" for read_file without path', () => {
    const call = makeToolCall('read_file', 'approved', {})
    const title = buildToolSummaryTitle(call)
    expect(title.title).toBe('读取文件')
  })

  it('marks read_file as error when exitCode is non-zero', () => {
    const call = makeToolCall('read_file', 'approved', { path: 'missing.txt' })
    const result = makeToolResult('read_file', { exitCode: 1 })
    const title = buildToolSummaryTitle(call, result)
    expect(title.title).toBe('读取文件 missing.txt')
    expect(title.isError).toBe(true)
  })

  it('returns command title for execute_command with command arg', () => {
    const call = makeToolCall('execute_command', 'approved', { command: 'git status' })
    const title = buildToolSummaryTitle(call)
    expect(title.title).toBe('执行命令 git status')
  })

  it('returns generic command title for execute_command without command arg', () => {
    const call = makeToolCall('execute_command', 'approved', {})
    const title = buildToolSummaryTitle(call)
    expect(title.title).toBe('执行命令 execute_command')
  })

  it('returns "搜索 \"{query}\"" for search_files with query', () => {
    const call = makeToolCall('search_files', 'approved', { query: 'TODO' })
    const title = buildToolSummaryTitle(call)
    expect(title.title).toBe('搜索 "TODO"')
  })

  it('returns "搜索 \"{regex}\"" for grep_search with regex', () => {
    const call = makeToolCall('grep_search', 'approved', { regex: 'function.*\\(' })
    const title = buildToolSummaryTitle(call)
    expect(title.title).toBe('搜索 "function.*\\("')
  })

  it('returns "搜索文件" for search without query or regex', () => {
    const call = makeToolCall('search_files', 'approved', {})
    const title = buildToolSummaryTitle(call)
    expect(title.title).toBe('搜索文件')
  })

  it('returns "列出目录 {path}" for list_dir with path', () => {
    const call = makeToolCall('list_dir', 'approved', { path: 'src/components' })
    const title = buildToolSummaryTitle(call)
    expect(title.title).toBe('列出目录 src/components')
  })

  it('returns "列出目录" for list_dir without path', () => {
    const call = makeToolCall('list_dir', 'approved', {})
    const title = buildToolSummaryTitle(call)
    expect(title.title).toBe('列出目录')
  })
})
