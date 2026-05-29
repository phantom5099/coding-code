import { API_BASE, api } from './api'

// ---- Models ----

export function listModels(): Promise<{ models: Array<{ id: string; name: string; provider: string; context_window: number }>; activeId: string | null }> {
  return api('/api/models')
}

// ---- Sessions ----

export function listSessions(cwd?: string): Promise<any[]> {
  const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
  return api(`/api/sessions${qs}`)
}

export function createSession(cwd: string, initialPermissionMode?: string): Promise<{ sessionId: string }> {
  return api('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd, initialPermissionMode }),
  })
}

export function deleteSession(sessionId: string): Promise<void> {
  return api(`/api/sessions/${sessionId}`, { method: 'DELETE' })
}

export function getSessionHistory(sessionId: string): Promise<Array<{ id: string; items: any[]; status: string }>> {
  return api(`/api/sessions/${sessionId}/history`)
}

export function sendApprovalResponse(sessionId: string, callId: string, response: string): Promise<void> {
  return fetch(`${API_BASE}/api/sessions/${sessionId}/approval/${callId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response }),
  }).then(() => {})
}

// ---- Settings: Memory ----

export function getMemoryConfig(): Promise<{ enabled: boolean; types: Array<{ name: string; description: string; isBuiltIn: boolean; disabled: boolean }> }> {
  return api('/api/settings/memory/config')
}

export function setMemoryEnabled(enabled: boolean): Promise<void> {
  return api('/api/settings/memory/enabled', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
}

export function setMemoryTypeDisabled(name: string, disabled: boolean): Promise<void> {
  return api('/api/settings/memory/type-disabled', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, disabled }),
  })
}

export function createMemoryExtraType(type: { name: string; description: string }): Promise<void> {
  return api('/api/settings/memory/extra-type', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(type),
  })
}

export function updateMemoryExtraType(name: string, type: { name: string; description: string }): Promise<void> {
  return api(`/api/settings/memory/extra-type/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(type),
  })
}

export function deleteMemoryExtraType(name: string): Promise<void> {
  return api(`/api/settings/memory/extra-type/${encodeURIComponent(name)}`, { method: 'DELETE' })
}

// ---- Settings: MCP ----

export function listMcpServers(cwd?: string): Promise<any[]> {
  const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
  return api(`/api/settings/mcp${qs}`)
}

export function setMcpDisabled(name: string, disabled: boolean): Promise<void> {
  return api(`/api/settings/mcp/${encodeURIComponent(name)}/disabled`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ disabled }),
  })
}

export function createMcpServer(cwd: string | undefined, server: Record<string, unknown>): Promise<void> {
  const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
  return api(`/api/settings/mcp${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(server),
  })
}

export function updateMcpServer(cwd: string | undefined, name: string, server: Record<string, unknown>): Promise<void> {
  const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
  return api(`/api/settings/mcp/${encodeURIComponent(name)}${qs}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(server),
  })
}

export function deleteMcpServer(cwd: string | undefined, name: string): Promise<void> {
  const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
  return api(`/api/settings/mcp/${encodeURIComponent(name)}${qs}`, { method: 'DELETE' })
}

// ---- Settings: Agents ----

export function listAgents(cwd?: string): Promise<any[]> {
  const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
  return api(`/api/settings/agents${qs}`)
}

export function setAgentDisabled(name: string, disabled: boolean): Promise<void> {
  return api(`/api/settings/agents/${encodeURIComponent(name)}/disabled`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ disabled }),
  })
}

export function createAgent(cwd: string | undefined, profile: Record<string, unknown>): Promise<void> {
  const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
  return api(`/api/settings/agents${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  })
}

export function updateAgent(cwd: string | undefined, name: string, profile: Record<string, unknown>): Promise<void> {
  const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
  return api(`/api/settings/agents/${encodeURIComponent(name)}${qs}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  })
}

export function deleteAgent(cwd: string | undefined, name: string): Promise<void> {
  const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
  return api(`/api/settings/agents/${encodeURIComponent(name)}${qs}`, { method: 'DELETE' })
}

// ---- Settings: Subagent enabled ----

export function getSubagentEnabled(): Promise<{ enabled: boolean }> {
  return api('/api/settings/subagent/enabled')
}

export function setSubagentEnabled(enabled: boolean): Promise<void> {
  return api('/api/settings/subagent/enabled', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
}

// ---- Settings: Skills ----

export function listSkills(): Promise<Array<{ name: string; description: string; disabled: boolean }>> {
  return api('/api/settings/skills')
}

export function toggleSkill(name: string, enabled: boolean): Promise<void> {
  return api('/api/settings/skills', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, enabled }),
  })
}

// ---- Settings: Hooks ----

export function listHooks(cwd?: string): Promise<any[]> {
  const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
  return api(`/api/settings/hooks${qs}`)
}

export function createHook(cwd: string | undefined, hook: Record<string, unknown>): Promise<void> {
  const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
  return api(`/api/settings/hooks${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(hook),
  })
}

export function updateHook(cwd: string | undefined, name: string, hook: Record<string, unknown>): Promise<void> {
  const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
  return api(`/api/settings/hooks/${encodeURIComponent(name)}${qs}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(hook),
  })
}

export function deleteHook(cwd: string | undefined, name: string): Promise<void> {
  const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
  return api(`/api/settings/hooks/${encodeURIComponent(name)}${qs}`, { method: 'DELETE' })
}

export function setHookDisabled(cwd: string | undefined, name: string, disabled: boolean): Promise<void> {
  const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
  return api(`/api/settings/hooks/${encodeURIComponent(name)}/disabled${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ disabled }),
  })
}

// ---- Rollback / Checkpoint ----

export interface CheckpointDiff {
  turnId: number
  files: Array<{ path: string; source: 'agent' | 'unknown'; status: string; diff: string; insertions: number; deletions: number }>
}

export interface CodeRollbackResult {
  reverted: boolean
  throughTurnId: number
  baseTurnId: number | null
  affectedTurns: number[]
  selectedFiles: string[]
  restoreEntry: CodeRestoreEntry | null
}

export interface CodeRollbackUndoResult {
  restored: boolean
  conflict: boolean
  conflictFiles: string[]
  restoredFiles: string[]
  remainingRolledBack: string[]
}

export interface RollbackPreviewDiff {
  throughTurnId: number
  baseTurnId: number | null
  affectedTurns: number[]
  diff: string
}

export interface CodeRestoreEntry {
  id: string
  sessionId: string
  action: string
  throughTurnId: number
  baseTurnId: number
  affectedTurns: number[]
  selectedFiles: string[]
  safetyCommit: string
  timestamp: string
}

export interface SessionRollbackState {
  context: { active: boolean; currentThroughTurnId: number | null }
  code: { canUndoLast: boolean; lastEntry: CodeRestoreEntry | null; revertedFiles: string[]; lastEntryId: string | null }
}

export function getCheckpointDiff(sessionId: string, cwd: string, turnId?: number): Promise<CheckpointDiff> {
  const segment = turnId != null ? String(turnId) : 'latest'
  return api(`/api/sessions/${sessionId}/checkpoints/${segment}/diff?cwd=${encodeURIComponent(cwd)}`)
}

export function revertCheckpointFile(sessionId: string, cwd: string, file: string): Promise<{ ok: boolean; result: CodeRollbackResult }> {
  return api(`/api/sessions/${sessionId}/checkpoints/latest/revert-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd, file }),
  })
}

export function revertCheckpointFiles(sessionId: string, cwd: string, files: string[]): Promise<{ ok: boolean; result: CodeRollbackResult }> {
  return api(`/api/sessions/${sessionId}/checkpoints/latest/revert-files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd, files }),
  })
}

export function revertCheckpointAgentFiles(sessionId: string, cwd: string): Promise<{ ok: boolean; result: CodeRollbackResult }> {
  return api(`/api/sessions/${sessionId}/checkpoints/latest/revert-agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd }),
  })
}

export function revertCheckpointAllFiles(sessionId: string, cwd: string): Promise<{ ok: boolean; result: CodeRollbackResult }> {
  return api(`/api/sessions/${sessionId}/checkpoints/latest/revert-all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd }),
  })
}

export function previewRollbackDiff(sessionId: string, cwd: string, throughTurnId: number): Promise<RollbackPreviewDiff> {
  return api(`/api/sessions/${sessionId}/rollback-preview?cwd=${encodeURIComponent(cwd)}&throughTurnId=${throughTurnId}`)
}

export function rollbackCodeToTurn(sessionId: string, cwd: string, throughTurnId: number): Promise<{ ok: boolean; result: CodeRollbackResult }> {
  return api(`/api/sessions/${sessionId}/rollback-code-to-turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd, throughTurnId }),
  })
}

export function rollbackContext(sessionId: string, cwd: string, throughTurnId: number): Promise<{ ok: boolean; turns: any[]; rolledBackMessage?: string }> {
  return api(`/api/sessions/${sessionId}/rollback-context`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd, throughTurnId }),
  })
}

export function rollbackBothToTurn(sessionId: string, cwd: string, throughTurnId: number): Promise<{ ok: boolean; turns: any[]; codeResult: CodeRollbackResult }> {
  return api(`/api/sessions/${sessionId}/rollback-both-to-turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd, throughTurnId }),
  })
}

export function undoLastCodeRollback(sessionId: string, cwd: string, force?: boolean, files?: string[]): Promise<{ ok: boolean; result: CodeRollbackUndoResult }> {
  return api(`/api/sessions/${sessionId}/undo-code-rollback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd, force, files }),
  })
}

export function getRollbackState(sessionId: string, cwd: string): Promise<SessionRollbackState> {
  return api(`/api/sessions/${sessionId}/rollback-state?cwd=${encodeURIComponent(cwd)}`)
}

export function forkSession(sessionId: string, cwd: string, atUuid?: string): Promise<{ sessionId: string; turns: any[] }> {
  return api(`/api/sessions/${sessionId}/fork`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd, atUuid }),
  })
}
