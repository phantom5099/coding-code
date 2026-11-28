import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { AgentError } from '@codingcode/util';
import { loadConfig, updateActiveModel } from '@codingcode/infra';

export type ModelDriver = 'openai' | 'deepseek' | (string & {});
export type ModelProtocol = 'openai-responses' | 'openai-chat' | 'deepseek-chat' | (string & {});

/** config/models.json 里每个模型的 capabilities 声明 */
export interface ModelCapabilitiesEntry {
  vision?: 'supported' | 'unsupported';
  audio?: 'supported' | 'unsupported';
  reasoning?: 'supported' | 'unsupported';
  thinking_levels?: string[];
  default_thinking_level?: string;
  thinking_force_enabled?: boolean;
}

export interface ModelReasoningCapability {
  supported: boolean;
  mode: 'optional' | 'always';
  levels: string[];
  defaultLevel?: string;
}

/** 准入要看的能力位 */
export interface ModelCapabilities {
  vision: boolean;
  audio: boolean;
  reasoning?: ModelReasoningCapability;
}

/** 模型清单里一条可被会话选中的模型 */
export interface SelectableModel {
  id: string;
  provider: string;
  driver: ModelDriver;
  name: string;
  model: string;
  base_url: string;
  api_key_env: string;
  protocol: ModelProtocol;
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
  driver: ModelDriver;
  base_url: string;
  api_key_env: string;
  default_model: string;
  protocol?: ModelProtocol;
  models: ModelDescriptor[];
}

export interface ProviderCatalog {
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
        protocol:
          p.protocol ??
          (p.name === 'openai'
            ? 'openai-responses'
            : p.name === 'deepseek'
              ? 'deepseek-chat'
              : 'openai-chat'),
        context_window: m.context_window ?? DEFAULT_CONTEXT_WINDOW,
        capabilities: {
          vision: m.capabilities?.vision === 'supported',
          audio: m.capabilities?.audio === 'supported',
          reasoning: {
            supported: m.capabilities?.reasoning === 'supported',
            mode: m.capabilities?.thinking_force_enabled ? 'always' : 'optional',
            levels: [...(m.capabilities?.thinking_levels ?? [])],
            ...(m.capabilities?.default_thinking_level
              ? { defaultLevel: m.capabilities.default_thinking_level }
              : {}),
          },
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

/** 精确复合 id 优先；裸名 / 显示名仅在唯一定位时使用 */
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

export function activeModelError(): string {
  const cfg = loadConfig().activeModel;
  if (!cfg) {
    return 'No active model configured. Set activeModel in config.yaml with model and apiKeyEnv fields';
  }
  return `Model "${cfg.model}" with apiKeyEnv "${cfg.apiKeyEnv}" not found in models.json`;
}

/** 统一模型解析：显式名称优先，空值回落全局激活模型，找不到报 CONFIG_INVALID */
export function resolveModelEntry(model?: string): SelectableModel {
  const target = model?.trim() ?? '';
  if (!target) {
    const entry = activeModel();
    if (!entry) throw new AgentError('CONFIG_INVALID', activeModelError());
    return entry;
  }
  const found = findModel(target);
  if (!found) throw new AgentError('CONFIG_INVALID', `Model "${target}" not found in models.json`);
  return found;
}

export function contextWindowOf(model: string): number {
  const target = model?.trim();
  const entry = target ? findModel(target) : activeModel();
  return entry?.context_window ?? DEFAULT_CONTEXT_WINDOW;
}

/** 指定模型的能力位；模型不存在时报 CONFIG_INVALID */
export function capabilitiesOf(model: string): ModelCapabilities {
  return resolveModelEntry(model).capabilities;
}

export function setGlobalActive(model: string): void {
  const found = findModel(model.trim());
  if (!found) {
    throw new AgentError('CONFIG_INVALID', `Model "${model}" not found in models.json`);
  }
  updateActiveModel({ model: found.model, apiKeyEnv: found.api_key_env });
}
