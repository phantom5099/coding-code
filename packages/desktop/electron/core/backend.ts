import { resolve } from 'path'
import { app } from 'electron'
import type { AgentClient } from '@codingcode/core'

// Per-thread clients
const clients = new Map<string, AgentClient>()
// Active send generators for abort support
const activeGens = new Map<string, AsyncGenerator<any>>()

let _ready = false

function getInstallRoot(): string {
  return resolve(app.getAppPath(), '../../')
}

export async function initBackend(workspaceCwd: string): Promise<void> {
  if (_ready) return
  const { initWorkspace, loadConfig, ensureUserConfig, bootstrapApplication, AppLayer } = await import('@codingcode/core')
  const { Effect } = await import('effect')
  ensureUserConfig()
  const config = loadConfig()
  initWorkspace({ installRoot: getInstallRoot(), workspaceCwd, config })
  await Effect.runPromise((bootstrapApplication(workspaceCwd) as any).pipe(Effect.provide(AppLayer)))
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

export async function listModels(): Promise<any> {
  const client = await getOrCreateClient('__meta__')
  return client.listModels()
}

export async function switchModel(id: string): Promise<void> {
  const meta = await getOrCreateClient('__meta__')
  await meta.switchModel(id)
  for (const [threadId, client] of clients) {
    if (threadId !== '__meta__') await client.switchModel(id)
  }
}

// Use any client for global operations (MCP, Skills, compact)
export function getAnyClient(): AgentClient | undefined {
  return clients.values().next().value
}
