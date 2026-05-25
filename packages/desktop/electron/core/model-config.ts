import { readFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { app } from 'electron'

interface ProviderEntry {
  name: string
  driver: string
  base_url: string
  api_key_env: string
  default_model: string
  models: Array<{ id: string; name: string }>
}

interface ModelCatalog {
  providers: ProviderEntry[]
}

export interface ProviderConfig {
  baseUrl: string
  apiKey: string
  modelId: string
  providerName: string
}

function findModelsJson(): string | null {
  const candidates = [
    join(resolve(app.getAppPath(), '../../../'), 'config/models.json'),
    join(app.getAppPath(), 'config/models.json'),
    join(process.cwd(), 'config/models.json'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

let _catalog: ModelCatalog | null = null

function getCatalog(): ModelCatalog {
  if (_catalog) return _catalog
  const path = findModelsJson()
  if (!path) return { providers: [] }
  try {
    _catalog = JSON.parse(readFileSync(path, 'utf-8')) as ModelCatalog
  } catch {
    _catalog = { providers: [] }
  }
  return _catalog
}

export function getProviderConfig(modelId: string): ProviderConfig | null {
  const catalog = getCatalog()
  for (const p of catalog.providers) {
    if (p.models.some((m) => m.id === modelId)) {
      const apiKey = process.env[p.api_key_env] ?? ''
      return { baseUrl: p.base_url, apiKey, modelId, providerName: p.name }
    }
  }
  return null
}

export interface ModelEntry {
  id: string
  name: string
  provider: string
}

export function listAllModels(): ModelEntry[] {
  const catalog = getCatalog()
  return catalog.providers.flatMap((p) =>
    p.models.map((m) => ({ id: m.id, name: m.name, provider: p.name }))
  )
}
