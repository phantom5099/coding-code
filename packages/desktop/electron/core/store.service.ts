import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { Thread } from '@shared/types'

interface StoreData {
  threads: Record<string, Thread>
  activeModel: string
  approvalPolicy: 'suggest' | 'auto-edit' | 'full-auto'
  workspace: { rootPath: string; name: string }
  messageHistory: Record<string, unknown[]>
}

const DEFAULTS: StoreData = {
  threads: {},
  activeModel: 'deepseek-v4-flash',
  approvalPolicy: 'suggest',
  workspace: { rootPath: '', name: '' },
  messageHistory: {},
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
      _data = { ...DEFAULTS, ...JSON.parse(readFileSync(path, 'utf-8')) }
    } else {
      _data = { ...DEFAULTS }
    }
  } catch {
    _data = { ...DEFAULTS }
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
  getMessageHistory(threadId: string): unknown[] {
    return load().messageHistory[threadId] ?? []
  },
  setMessageHistory(threadId: string, messages: unknown[]): void {
    load().messageHistory[threadId] = messages
    save()
  },
}
