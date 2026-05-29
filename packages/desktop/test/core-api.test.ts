import { describe, it, expect, vi } from 'vitest'

// Mock the api module
vi.mock('../src/lib/api', () => ({
  API_BASE: 'http://127.0.0.1:8080',
  api: vi.fn(),
}))

import { api } from '../src/lib/api'

// Re-import core-api after mocking api
async function getCoreApi() {
  return await import('../src/lib/core-api')
}

describe('core-api - path building', () => {
  it('listModels calls GET /api/models', async () => {
    const coreApi = await getCoreApi()
    await coreApi.listModels()
    expect(api).toHaveBeenCalledWith('/api/models')
  })

  it('listSessions builds query param from cwd', async () => {
    const coreApi = await getCoreApi()
    await coreApi.listSessions('C:/x')
    expect(api).toHaveBeenCalledWith('/api/sessions?cwd=C%3A%2Fx')
  })

  it('listSessions omits query when no cwd', async () => {
    const coreApi = await getCoreApi()
    await coreApi.listSessions()
    expect(api).toHaveBeenCalledWith('/api/sessions')
  })

  it('createSession posts to /api/sessions', async () => {
    const coreApi = await getCoreApi()
    await coreApi.createSession('C:/x', 'default')
    expect(api).toHaveBeenCalledWith('/api/sessions', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('C:/x'),
    }))
  })

  it('deleteSession calls DELETE /api/sessions/:id', async () => {
    const coreApi = await getCoreApi()
    await coreApi.deleteSession('session-123')
    expect(api).toHaveBeenCalledWith('/api/sessions/session-123', { method: 'DELETE' })
  })

  it('getSessionHistory calls GET /api/sessions/:id/history', async () => {
    const coreApi = await getCoreApi()
    await coreApi.getSessionHistory('session-123')
    expect(api).toHaveBeenCalledWith('/api/sessions/session-123/history')
  })

  it('setMcpDisabled posts to /api/settings/mcp/:name/disabled', async () => {
    const coreApi = await getCoreApi()
    await coreApi.setMcpDisabled('foo', true)
    expect(api).toHaveBeenCalledWith('/api/settings/mcp/foo/disabled', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ disabled: true }),
    }))
  })

  it('createMcpServer uses cwd query param', async () => {
    const coreApi = await getCoreApi()
    await coreApi.createMcpServer('C:/x', { name: 'test' })
    expect(api).toHaveBeenCalledWith('/api/settings/mcp?cwd=C%3A%2Fx', expect.objectContaining({
      method: 'POST',
    }))
  })

  it('createAgent uses cwd query param', async () => {
    const coreApi = await getCoreApi()
    await coreApi.createAgent('C:/x', { name: 'test-agent' })
    expect(api).toHaveBeenCalledWith('/api/settings/agents?cwd=C%3A%2Fx', expect.objectContaining({
      method: 'POST',
    }))
  })

  it('updateAgent uses PUT with name in path', async () => {
    const coreApi = await getCoreApi()
    await coreApi.updateAgent('C:/x', 'old-name', { name: 'new-name' })
    expect(api).toHaveBeenCalledWith('/api/settings/agents/old-name?cwd=C%3A%2Fx', expect.objectContaining({
      method: 'PUT',
    }))
  })

  it('setHookDisabled uses cwd and disabled body', async () => {
    const coreApi = await getCoreApi()
    await coreApi.setHookDisabled('C:/x', 'my-hook', true)
    expect(api).toHaveBeenCalledWith(
      '/api/settings/hooks/my-hook/disabled?cwd=C%3A%2Fx',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ disabled: true }),
      }),
    )
  })

  it('listHooks uses cwd query param', async () => {
    const coreApi = await getCoreApi()
    await coreApi.listHooks('C:/x')
    expect(api).toHaveBeenCalledWith('/api/settings/hooks?cwd=C%3A%2Fx')
  })

  it('getMemoryConfig calls GET /api/settings/memory/config', async () => {
    const coreApi = await getCoreApi()
    await coreApi.getMemoryConfig()
    expect(api).toHaveBeenCalledWith('/api/settings/memory/config')
  })

  it('setMemoryEnabled posts to /api/settings/memory/enabled', async () => {
    const coreApi = await getCoreApi()
    await coreApi.setMemoryEnabled(true)
    expect(api).toHaveBeenCalledWith('/api/settings/memory/enabled', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ enabled: true }),
    }))
  })

  it('listSkills calls GET /api/settings/skills', async () => {
    const coreApi = await getCoreApi()
    await coreApi.listSkills()
    expect(api).toHaveBeenCalledWith('/api/settings/skills')
  })

  it('toggleSkill posts to /api/settings/skills', async () => {
    const coreApi = await getCoreApi()
    await coreApi.toggleSkill('test-skill', true)
    expect(api).toHaveBeenCalledWith('/api/settings/skills', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'test-skill', enabled: true }),
    }))
  })

  it('getSubagentEnabled calls GET /api/settings/subagent/enabled', async () => {
    const coreApi = await getCoreApi()
    await coreApi.getSubagentEnabled()
    expect(api).toHaveBeenCalledWith('/api/settings/subagent/enabled')
  })

  it('setSubagentEnabled posts to /api/settings/subagent/enabled', async () => {
    const coreApi = await getCoreApi()
    await coreApi.setSubagentEnabled(true)
    expect(api).toHaveBeenCalledWith('/api/settings/subagent/enabled', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ enabled: true }),
    }))
  })

  it('getCheckpointDiff uses turnId in path when provided', async () => {
    const coreApi = await getCoreApi()
    await coreApi.getCheckpointDiff('session-123', 'C:/x', 3)
    expect(api).toHaveBeenCalledWith('/api/sessions/session-123/checkpoints/3/diff?cwd=C%3A%2Fx')
  })

  it('getCheckpointDiff uses latest in path when turnId omitted', async () => {
    const coreApi = await getCoreApi()
    await coreApi.getCheckpointDiff('session-123', 'C:/x')
    expect(api).toHaveBeenCalledWith('/api/sessions/session-123/checkpoints/latest/diff?cwd=C%3A%2Fx')
  })
})
