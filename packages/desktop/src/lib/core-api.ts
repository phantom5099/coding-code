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
