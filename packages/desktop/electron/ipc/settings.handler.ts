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
}
