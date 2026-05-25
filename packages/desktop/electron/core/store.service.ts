import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

interface StoreData {
  approvalPolicy: 'suggest' | 'auto-edit' | 'full-auto'
  workspace: { rootPath: string; name: string }
  sessionIds: Record<string, string>
}

const DEFAULTS: StoreData = {
  approvalPolicy: 'suggest',
  workspace: { rootPath: '', name: '' },
  sessionIds: {},
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
      }
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
  getAllSessionIds(): Record<string, string> {
    return { ...load().sessionIds }
  },
  removeSessionId(threadId: string): void {
    delete load().sessionIds[threadId]
    save()
  },
}
