import { describe, it, expect } from 'vitest'
import { buildToolSummaryTitle } from '../src/shared/ToolSummary'
import type { Item } from '../shared/types'

function makeToolCall(name: string, status: Item & { type: 'tool_call' }['status'], args?: object): Item & { type: 'tool_call' } {
  return { id: 'tc-' + name, type: 'tool_call', name, args: args ?? {}, status }
}

function makeToolResult(
  name: string,
  opts?: Partial<Item & { type: 'tool_result' }>,
): Item & { type: 'tool_result' } {
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

  it('returns "成功创建" for write_file with insertions only', () => {
    const call = makeToolCall('write_file', 'approved')
    const result = makeToolResult('write_file', { filePath: 'foo.ts', insertions: 5, deletions: 0 })
    const title = buildToolSummaryTitle(call, result)
    expect(title.title).toBe('成功创建 foo.ts')
    expect(title.isRejected).toBe(false)
    expect(title.isError).toBe(false)
  })

  it('returns "成功编辑" for edit_file with deletions', () => {
    const call = makeToolCall('edit_file', 'approved')
    const result = makeToolResult('edit_file', { filePath: 'bar.ts', insertions: 3, deletions: 2 })
    const title = buildToolSummaryTitle(call, result)
    expect(title.title).toBe('成功编辑 bar.ts')
  })

  it('returns "成功编辑" for apply_patch', () => {
    const call = makeToolCall('apply_patch', 'approved')
    const result = makeToolResult('apply_patch', { filePath: 'baz.ts', insertions: 1, deletions: 1 })
    const title = buildToolSummaryTitle(call, result)
    expect(title.title).toBe('成功编辑 baz.ts')
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
    expect(title.title).toBe('成功编辑 src/foo.ts')
  })

  it('extracts path from args.file_path for edit_file without toolResult', () => {
    const call = makeToolCall('edit_file', 'approved', { file_path: 'src/bar.ts' })
    const title = buildToolSummaryTitle(call)
    expect(title.title).toBe('成功编辑 src/bar.ts')
  })

  it('falls back to tool name when file tool has no path in args or result', () => {
    const call = makeToolCall('apply_patch', 'approved', {})
    const title = buildToolSummaryTitle(call)
    expect(title.title).toBe('apply_patch 结果')
  })

  it('prefers toolResult.filePath over args.path', () => {
    const call = makeToolCall('write_file', 'approved', { path: 'args.ts' })
    const result = makeToolResult('write_file', { filePath: 'result.ts' })
    const title = buildToolSummaryTitle(call, result)
    expect(title.title).toBe('成功编辑 result.ts')
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
