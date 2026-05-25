import { describe, it, expect } from 'vitest'
import { readUIHistory, deleteSession } from '../../src/session/store.js'
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// Helper to write a fake session JSONL for testing
const SESSIONS_DIR = join(homedir(), '.codingcode', 'sessions')

function writeTestSession(slug: string, sessionId: string, lines: object[]): string {
  const dir = join(SESSIONS_DIR, slug)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${sessionId}.jsonl`)
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8')
  return path
}

function cleanupSession(slug: string, sessionId: string): void {
  const dir = join(SESSIONS_DIR, slug)
  const jsonl = join(dir, `${sessionId}.jsonl`)
  const idx = join(dir, `${sessionId}.index.json`)
  try { if (existsSync(jsonl)) unlinkSync(jsonl) } catch {}
  try { if (existsSync(idx)) unlinkSync(idx) } catch {}
}

describe('readUIHistory', () => {
  it('returns empty array for unknown session', () => {
    const result = readUIHistory('nonexistent-session-id-xyz')
    expect(result).toEqual([])
  })

  it('converts user and assistant events into turns', () => {
    const sessionId = 'test-ui-history-basic'
    const slug = 'test-project'
    writeTestSession(slug, sessionId, [
      { type: 'session_meta', sessionId, projectSlug: slug, cwd: '/test', model: 'claude', createdAt: new Date().toISOString(), version: '1' },
      { type: 'user', turnId: 0, uuid: 'u1', content: 'Hello', timestamp: new Date().toISOString() },
      { type: 'assistant', turnId: 0, uuid: 'a1', content: 'Hi there', toolCalls: [], model: 'claude', timestamp: new Date().toISOString() },
    ])

    try {
      const turns = readUIHistory(sessionId)
      expect(turns).toHaveLength(1)
      expect(turns[0]!.id).toBe('0')
      expect(turns[0]!.status).toBe('completed')
      const items = turns[0]!.items as any[]
      expect(items).toHaveLength(2)
      expect(items[0]).toMatchObject({ type: 'message', role: 'user', content: 'Hello' })
      expect(items[1]).toMatchObject({ type: 'message', role: 'assistant', content: 'Hi there' })
    } finally {
      cleanupSession(slug, sessionId)
    }
  })

  it('groups events by turnId into separate turns', () => {
    const sessionId = 'test-ui-history-turns'
    const slug = 'test-project'
    writeTestSession(slug, sessionId, [
      { type: 'session_meta', sessionId, projectSlug: slug, cwd: '/test', model: 'claude', createdAt: new Date().toISOString(), version: '1' },
      { type: 'user', turnId: 0, uuid: 'u1', content: 'First', timestamp: new Date().toISOString() },
      { type: 'assistant', turnId: 0, uuid: 'a1', content: 'Reply 1', toolCalls: [], model: 'claude', timestamp: new Date().toISOString() },
      { type: 'user', turnId: 1, uuid: 'u2', content: 'Second', timestamp: new Date().toISOString() },
      { type: 'assistant', turnId: 1, uuid: 'a2', content: 'Reply 2', toolCalls: [], model: 'claude', timestamp: new Date().toISOString() },
    ])

    try {
      const turns = readUIHistory(sessionId)
      expect(turns).toHaveLength(2)
      expect(turns[0]!.id).toBe('0')
      expect(turns[1]!.id).toBe('1')
      const firstItems = turns[0]!.items as any[]
      expect(firstItems[0]).toMatchObject({ content: 'First' })
      const secondItems = turns[1]!.items as any[]
      expect(secondItems[0]).toMatchObject({ content: 'Second' })
    } finally {
      cleanupSession(slug, sessionId)
    }
  })

  it('converts tool_calls in assistant events into tool_call items', () => {
    const sessionId = 'test-ui-history-tools'
    const slug = 'test-project'
    writeTestSession(slug, sessionId, [
      { type: 'session_meta', sessionId, projectSlug: slug, cwd: '/test', model: 'claude', createdAt: new Date().toISOString(), version: '1' },
      { type: 'user', turnId: 0, uuid: 'u1', content: 'Run ls', timestamp: new Date().toISOString() },
      { type: 'assistant', turnId: 0, uuid: 'a1', content: '', toolCalls: [{ id: 'tc1', name: 'bash', arguments: '{"command":"ls"}' }], model: 'claude', timestamp: new Date().toISOString() },
      { type: 'tool_result', turnId: 0, uuid: 'tr1', parentUuid: 'a1', toolName: 'bash', toolCallId: 'tc1', output: 'file.txt', timestamp: new Date().toISOString(), tokenCount: 5 },
    ])

    try {
      const turns = readUIHistory(sessionId)
      expect(turns).toHaveLength(1)
      const items = turns[0]!.items as any[]
      // user message + tool_call + tool_result (no assistant text since content is empty)
      expect(items).toHaveLength(3)
      expect(items[0]).toMatchObject({ type: 'message', role: 'user' })
      expect(items[1]).toMatchObject({ type: 'tool_call', name: 'bash', args: { command: 'ls' }, status: 'approved' })
      expect(items[2]).toMatchObject({ type: 'tool_result', callId: 'tc1', output: 'file.txt' })
    } finally {
      cleanupSession(slug, sessionId)
    }
  })
})

describe('deleteSession', () => {
  it('removes the jsonl file', () => {
    const sessionId = 'test-delete-session'
    const slug = 'test-project'
    const path = writeTestSession(slug, sessionId, [
      { type: 'session_meta', sessionId, projectSlug: slug, cwd: '/test', model: 'claude', createdAt: new Date().toISOString(), version: '1' },
    ])

    expect(existsSync(path)).toBe(true)
    deleteSession(sessionId)
    expect(existsSync(path)).toBe(false)
  })

  it('removes subagents directory when present', () => {
    const sessionId = 'test-delete-with-subagents'
    const slug = 'test-project'
    const path = writeTestSession(slug, sessionId, [
      { type: 'session_meta', sessionId, projectSlug: slug, cwd: '/test', model: 'claude', createdAt: new Date().toISOString(), version: '1' },
    ])
    const subagentDir = join(SESSIONS_DIR, slug, sessionId, 'subagents')
    mkdirSync(subagentDir, { recursive: true })
    writeFileSync(join(subagentDir, 'child.jsonl'), '', 'utf8')

    expect(existsSync(path)).toBe(true)
    expect(existsSync(subagentDir)).toBe(true)
    deleteSession(sessionId)
    expect(existsSync(path)).toBe(false)
    expect(existsSync(subagentDir)).toBe(false)
  })

  it('does nothing for unknown session', () => {
    expect(() => deleteSession('nonexistent-session-id-xyz')).not.toThrow()
  })
})
