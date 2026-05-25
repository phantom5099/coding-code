import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executeTool, TOOL_MAP } from '../electron/core/tools'

describe('tool registry', () => {
  it('registers all expected tools', () => {
    expect(TOOL_MAP.has('list_dir')).toBe(true)
    expect(TOOL_MAP.has('file_read')).toBe(true)
    expect(TOOL_MAP.has('apply_patch')).toBe(true)
    expect(TOOL_MAP.has('shell')).toBe(true)
    expect(TOOL_MAP.has('search')).toBe(true)
  })

  it('returns error for unknown tool', async () => {
    const result = await executeTool('nonexistent_tool', {}, process.cwd())
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('Unknown tool')
  })

  it('list_dir lists current directory', async () => {
    const result = await executeTool('list_dir', { path: '.' }, process.cwd())
    expect(result.exitCode).toBeUndefined()
    expect(result.output.length).toBeGreaterThan(0)
  })

  it('file_read returns file content', async () => {
    const result = await executeTool('file_read', { path: 'package.json' }, process.cwd())
    expect(result.output).toContain('@codingcode/desktop')
  })

  it('file_read returns error for missing file', async () => {
    const result = await executeTool('file_read', { path: 'nonexistent_file.txt' }, process.cwd())
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('Error reading file')
  })

  it('shell executes commands and captures output', async () => {
    const result = await executeTool('shell', { command: 'echo hello' }, process.cwd())
    expect(result.output).toContain('hello')
    expect(result.exitCode).toBe(0)
  })
})
