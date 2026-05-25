import { resolve } from 'path'
import { app } from 'electron'
import type { AgentClient, SelectableModel } from '@codingcode/core'

// Per-thread clients
const clients = new Map<string, AgentClient>()
// Active send generators for abort support
const activeGens = new Map<string, AsyncGenerator<any>>()

let _ready = false

function getInstallRoot(): string {
  // In dev: app.getAppPath() = packages/desktop/out/main, go up 3 to repo root
  // In prod: app.getAppPath() = app.asar root, config is in resourcesPath
  if (process.env['ELECTRON_RENDERER_URL']) {
    return resolve(app.getAppPath(), '../../../')
  }
  return resolve(app.getAppPath(), '../../../')
}

export async function initBackend(workspaceCwd: string): Promise<void> {
  if (_ready) return
  const { initWorkspace } = await import('@codingcode/core')
  initWorkspace({ installRoot: getInstallRoot(), workspaceCwd })
  _ready = true
}

export async function updateWorkspace(workspaceCwd: string): Promise<void> {
  const { initWorkspace } = await import('@codingcode/core')
  initWorkspace({ installRoot: getInstallRoot(), workspaceCwd })
}

async function makeClient(): Promise<AgentClient> {
  const { createDirectClient, getLLMClient } = await import('@codingcode/core')
  const llmResult = await getLLMClient()
  if (!llmResult.ok) throw new Error(llmResult.error.message)
  return createDirectClient(llmResult.value)
}

export async function getOrCreateClient(threadId: string): Promise<AgentClient> {
  if (clients.has(threadId)) return clients.get(threadId)!
  const client = await makeClient()
  clients.set(threadId, client)
  return client
}

export function deleteClient(threadId: string): void {
  clients.delete(threadId)
}

export function setActiveGen(threadId: string, gen: AsyncGenerator<any>): void {
  activeGens.set(threadId, gen)
}

export function abortAndClear(threadId: string): void {
  const gen = activeGens.get(threadId)
  if (gen) {
    gen.return(undefined).catch(() => {})
    activeGens.delete(threadId)
  }
}

export async function listModels(): Promise<{ models: SelectableModel[]; activeId: string | null }> {
  const { listModels: coreListModels, getActiveEntry } = await import('@codingcode/core')
  const modelsResult = coreListModels()
  const models = modelsResult.ok ? modelsResult.value : []
  const activeResult = getActiveEntry()
  const activeId = activeResult.ok ? activeResult.value.id : null
  return { models, activeId }
}

export async function switchModel(id: string): Promise<void> {
  const { switchActiveModel, getLLMClient } = await import('@codingcode/core')
  const result = switchActiveModel(id)
  if (!result.ok) throw new Error(result.error.message)
  // Refresh all existing clients
  const newLlm = await getLLMClient()
  if (!newLlm.ok) throw new Error(newLlm.error.message)
  for (const client of clients.values()) {
    await client.switchModel(id)
  }
}

// Use any client for global operations (MCP, Skills, compact)
export function getAnyClient(): AgentClient | undefined {
  return clients.values().next().value
}
