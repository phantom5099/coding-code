import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { AgentError } from '../util/error.js';
import { loadConfig, updateActiveModel } from './config.js';

/** config/models.json 里每个模型的 capabilities 声明。 */
export interface ModelCapabilitiesEntry {
  vision?: 'supported' | 'unsupported';
  audio?: 'supported' | 'unsupported';
}

/** 准入要看的能力位。 */
export interface ModelCapabilities {
  vision: boolean;
  audio: boolean;
}

/** 模型清单里一条可被会话选中的模型。 */
export interface SelectableModel {
  id: string;
  provider: string;
  driver: string;
  name: string;
  model: string;
  base_url: string;
  api_key_env: string;
  context_window: number;
  capabilities: ModelCapabilities;
}

export interface ModelDescriptor {
  id: string;
  name: string;
  context_window?: number;
  capabilities?: ModelCapabilitiesEntry;
}

export interface ProviderEntry {
  name: string;
  driver: string;
  base_url: string;
  api_key_env: string;
  default_model: string;
  models: ModelDescriptor[];
}

interface ProviderCatalog {
  providers: ProviderEntry[];
}

const DEFAULT_CONTEXT_WINDOW = 128000;

let cached: ProviderCatalog | null = null;

function modelsFile(): string {
  const projectRoot = process.env.CODINGCODE_PROJECT_ROOT ?? process.cwd();
  return join(projectRoot, 'config', 'models.json');
}

function readCatalog(): ProviderCatalog | null {
  if (cached) return cached;
  const path = modelsFile();
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as ProviderCatalog;
    if (!parsed.providers || parsed.providers.length === 0) return null;
    cached = parsed;
    return cached;
  } catch {
    return null;
  }
}

export function flattenModels(cat: ProviderCatalog): SelectableModel[] {
  const result: SelectableModel[] = [];
  for (const p of cat.providers) {
    for (const m of p.models) {
      result.push({
        id: `${m.id}@${p.name}`,
        provider: p.name,
        driver: p.driver,
        name: m.name,
        model: m.id,
        base_url: p.base_url,
        api_key_env: p.api_key_env,
        context_window: m.context_window ?? DEFAULT_CONTEXT_WINDOW,
        capabilities: {
          vision: m.capabilities?.vision === 'supported',
          audio: m.capabilities?.audio === 'supported',
        },
      });
    }
  }
  return result;
}

export function listModels(): SelectableModel[] {
  const cat = readCatalog();
  return cat ? flattenModels(cat) : [];
}

/** 精确复合 id 优先；裸名 / 显示名仅在唯一定位时使用（配置文件允许写裸名） */
export function findModel(target: string): SelectableModel | null {
  const models = listModels();
  const exact = models.find((m) => m.id === target);
  if (exact) return exact;
  return models.find((m) => m.model === target || m.name === target) ?? null;
}

/** config.yaml 的 activeModel → 模型条目；未配置或匹配不上时 null */
export function activeModel(): SelectableModel | null {
  const cfg = loadConfig().activeModel;
  if (!cfg) return null;
  return listModels().find((m) => m.model === cfg.model && m.api_key_env === cfg.apiKeyEnv) ?? null;
}

export function activeModelId(): string {
  return activeModel()?.id ?? '';
}

/** activeModel 取不到时的说明文字 */
export function activeModelError(): string {
  const cfg = loadConfig().activeModel;
  if (!cfg) {
    return 'No active model configured. Set activeModel in config.yaml with model and apiKeyEnv fields';
  }
  return `Model "${cfg.model}" with apiKeyEnv "${cfg.apiKeyEnv}" not found in models.json`;
}

export function contextWindowOf(model: string): number {
  const target = model?.trim();
  const entry = target ? findModel(target) : activeModel();
  return entry?.context_window ?? DEFAULT_CONTEXT_WINDOW;
}

/** 指定模型的能力位；模型不存在时报 CONFIG_INVALID。 */
export function capabilitiesOf(model: string): ModelCapabilities {
  const target = model?.trim();
  if (!target) {
    const entry = activeModel();
    if (!entry) throw new AgentError('CONFIG_INVALID', activeModelError());
    return entry.capabilities;
  }
  const found = findModel(target);
  if (!found) throw new AgentError('CONFIG_INVALID', `Model "${target}" not found in models.json`);
  return found.capabilities;
}

export function setGlobalActive(model: string): void {
  const found = findModel(model.trim());
  if (!found) {
    throw new AgentError('CONFIG_INVALID', `Model "${model}" not found in models.json`);
  }
  updateActiveModel(found.model, found.api_key_env);
}
