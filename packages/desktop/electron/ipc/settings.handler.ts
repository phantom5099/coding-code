import { ipcMain } from 'electron'
import { getOrCreateClient, getAnyClient } from '../core/backend'

async function ensureClient() {
  return getAnyClient() ?? getOrCreateClient('__settings__')
}

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:getMcp', async () => {
    const client = await ensureClient()
    const statuses = await client.getMcpStatus()
    return statuses.map((s) => ({
      name: s.name,
      transport: s.transport,
      disabled: s.disabled,
      toolCount: s.toolCount,
    }))
  })

  ipcMain.handle('settings:setMcpDisabled', async (_e, name: string, disabled: boolean) => {
    const client = await ensureClient()
    if (disabled) {
      await client.disableMcp(name)
    } else {
      await client.enableMcp(name)
    }
  })

  ipcMain.handle('settings:createMcp', async (_e, server: any) => {
    const client = await ensureClient()
    await client.createMcpServer(server)
  })

  ipcMain.handle('settings:updateMcp', async (_e, name: string, server: any) => {
    const client = await ensureClient()
    await client.updateMcpServer(name, server)
  })

  ipcMain.handle('settings:deleteMcp', async (_e, name: string) => {
    const client = await ensureClient()
    await client.deleteMcpServer(name)
  })

  ipcMain.handle('settings:getSkills', async () => {
    const client = await ensureClient()
    const skills = await client.listSkills()
    return skills.map((s) => ({
      name: s.name,
      description: s.description,
      disabled: !s.enabled,
    }))
  })

  ipcMain.handle('settings:setSkillDisabled', async (_e, name: string, disabled: boolean) => {
    const client = await ensureClient()
    await client.toggleSkill(name, !disabled)
  })

  ipcMain.handle('settings:getAgents', async () => {
    const client = await ensureClient()
    return client.listAgents()
  })

  ipcMain.handle('settings:getSubagentEnabled', async () => {
    const client = await ensureClient()
    return client.getSubagentEnabled()
  })

  ipcMain.handle('settings:setSubagentEnabled', async (_e, enabled: boolean) => {
    const client = await ensureClient()
    await client.setSubagentEnabled(enabled)
  })

  ipcMain.handle('settings:createAgent', async (_e, profile: any) => {
    const client = await ensureClient()
    await client.createAgent(profile)
  })

  ipcMain.handle('settings:updateAgent', async (_e, name: string, profile: any) => {
    const client = await ensureClient()
    await client.updateAgent(name, profile)
  })

  ipcMain.handle('settings:deleteAgent', async (_e, name: string) => {
    const client = await ensureClient()
    await client.deleteAgent(name)
  })

  ipcMain.handle('settings:setAgentDisabled', async (_e, name: string, disabled: boolean) => {
    const client = await ensureClient()
    await client.setAgentDisabled(name, disabled)
  })

  ipcMain.handle('settings:getHooks', async () => {
    const client = await ensureClient()
    return client.listHooks()
  })

  ipcMain.handle('settings:createHook', async (_e, hook: any) => {
    const client = await ensureClient()
    await client.createHook(hook)
  })

  ipcMain.handle('settings:updateHook', async (_e, name: string, hook: any) => {
    const client = await ensureClient()
    await client.updateHook(name, hook)
  })

  ipcMain.handle('settings:deleteHook', async (_e, name: string) => {
    const client = await ensureClient()
    await client.deleteHook(name)
  })

  ipcMain.handle('settings:setHookDisabled', async (_e, name: string, disabled: boolean) => {
    const client = await ensureClient()
    await client.setHookDisabled(name, disabled)
  })
}
