import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { Thread } from '@shared/types'

interface StoreSettings {
  disabledMcpServers: string[]
  disabledSkills: string[]
}

interface StoreData {
  threads: Record<string, Thread>
  activeModel: string
  approvalPolicy: 'suggest' | 'auto-edit' | 'full-auto'
  workspace: { rootPath: string; name: string }
  sessionIds: Record<string, string>
  settings: StoreSettings
}

const DEFAULTS: StoreData = {
  threads: {},
  activeModel: 'deepseek-v4-flash',
  approvalPolicy: 'suggest',
  workspace: { rootPath: '', name: '' },
  sessionIds: {},
  settings: { disabledMcpServers: [], disabledSkills: [] },
}

let _storePath: string | null = null
let _data: StoreData | null = null

function getStorePath(): string {
  if (!_storePath) {
    const dir = app.getPath('userData')
    _storePath = join(dir, 'store.json')
  }
  return _storePath
}

function load(): StoreData {
  if (_data) return _data
  const path = getStorePath()
  try {
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, 'utf-8'))
      _data = {
        ...DEFAULTS,
        ...parsed,
        sessionIds: parsed.sessionIds ?? {},
        settings: { ...DEFAULTS.settings, ...(parsed.settings ?? {}) },
      }
    } else {
      _data = { ...DEFAULTS, settings: { ...DEFAULTS.settings } }
    }
  } catch {
    _data = { ...DEFAULTS, settings: { ...DEFAULTS.settings } }
  }
  return _data!
}

function save(): void {
  const path = getStorePath()
  try {
    writeFileSync(path, JSON.stringify(_data, null, 2), 'utf-8')
  } catch {}
}

export const storeService = {
  getThread(id: string): Thread | undefined {
    return load().threads[id]
  },
  getAllThreads(): Thread[] {
    return Object.values(load().threads).sort((a, b) => b.updatedAt - a.updatedAt)
  },
  upsertThread(thread: Thread): void {
    load().threads[thread.id] = thread
    save()
  },
  deleteThread(id: string): void {
    delete load().threads[id]
    save()
  },
  getActiveModel(): string {
    return load().activeModel
  },
  setActiveModel(model: string): void {
    load().activeModel = model
    save()
  },
  getApprovalPolicy(): 'suggest' | 'auto-edit' | 'full-auto' {
    return load().approvalPolicy
  },
  setApprovalPolicy(policy: 'suggest' | 'auto-edit' | 'full-auto'): void {
    load().approvalPolicy = policy
    save()
  },
  getWorkspace(): { rootPath: string; name: string } {
    return load().workspace
  },
  setWorkspace(rootPath: string, name: string): void {
    load().workspace = { rootPath, name }
    save()
  },
  getSessionId(threadId: string): string | undefined {
    return load().sessionIds[threadId]
  },
  setSessionId(threadId: string, sessionId: string): void {
    load().sessionIds[threadId] = sessionId
    save()
  },
  getDisabledMcpServers(): string[] {
    return load().settings.disabledMcpServers
  },
  setDisabledMcpServers(names: string[]): void {
    load().settings.disabledMcpServers = names
    save()
  },
  getDisabledSkills(): string[] {
    return load().settings.disabledSkills
  },
  setDisabledSkills(names: string[]): void {
    load().settings.disabledSkills = names
    save()
  },
}
