import type { LanguageModelV3 } from "@ai-sdk/provider";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// ── JSON Schema types ──────────────────────────────────────────────

export interface ModelDescriptor {
  id: string;
  name: string;
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
  active: string;
  providers: ProviderEntry[];
}

// ── Flat selectable model (derived, for UI / runtime) ──────────────

export interface SelectableModel {
  id: string; // compound: "modelId@providerName"
  provider: string;
  driver: string;
  name: string;
  model: string;
  base_url: string;
  api_key_env: string;
}

// ── Module state ───────────────────────────────────────────────────

const MODELS_FILE = resolve(process.cwd(), "models.json");

let catalog: ProviderCatalog | null = null;
let currentEntry: SelectableModel | null = null;
let currentModel: LanguageModelV3 | null = null;

// ── Load catalog ───────────────────────────────────────────────────

function loadCatalog(): ProviderCatalog {
  if (catalog) return catalog;
  if (!existsSync(MODELS_FILE)) {
    throw new Error(`models.json not found at ${MODELS_FILE}`);
  }
  const raw = readFileSync(MODELS_FILE, "utf-8");
  const parsed = JSON.parse(raw) as ProviderCatalog;
  if (!parsed.providers || parsed.providers.length === 0) {
    throw new Error("models.json has no providers defined");
  }
  catalog = parsed;
  return catalog;
}

// ── Flatten provider structure into selectable entries ─────────────

function flattenModels(cat: ProviderCatalog): SelectableModel[] {
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
      });
    }
  }
  return result;
}

function resolveApiKey(entry: SelectableModel): string {
  return process.env[entry.api_key_env] || process.env.OPENAI_API_KEY || "";
}

// ── Build Vercel AI SDK model ──────────────────────────────────────

async function buildModel(entry: SelectableModel): Promise<LanguageModelV3> {
  const apiKey = resolveApiKey(entry);

  switch (entry.driver) {
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      const provider = createOpenAI({
        name: entry.provider,
        baseURL: entry.base_url,
        apiKey,
      });
      return provider.chat(entry.model) as LanguageModelV3;
    }

    case "deepseek": {
      const { createDeepSeek } = await import("@ai-sdk/deepseek");
      const deepseek = createDeepSeek({
        baseURL: entry.base_url,
        apiKey,
      });
      return deepseek(entry.model) as LanguageModelV3;
    }

    default:
      throw new Error(
        `Unknown driver "${entry.driver}" for provider "${entry.provider}". ` +
          `Supported: openai, deepseek. ` +
          `Install the corresponding @ai-sdk/* package if needed.`
      );
  }
}

// ── Exported API ───────────────────────────────────────────────────

export function listModels(): SelectableModel[] {
  return flattenModels(loadCatalog());
}

export function getActiveEntry(): SelectableModel {
  if (currentEntry) return currentEntry;

  const cat = loadCatalog();
  const activeProviderName = cat.active;
  const provider = cat.providers.find((p) => p.name === activeProviderName);
  if (!provider) {
    throw new Error(`Active provider "${activeProviderName}" not found in models.json`);
  }

  const model = provider.models.find((m) => m.id === provider.default_model);
  if (!model) {
    throw new Error(
      `Default model "${provider.default_model}" not found in provider "${provider.name}"`
    );
  }

  currentEntry = {
    id: `${model.id}@${provider.name}`,
    provider: provider.name,
    driver: provider.driver,
    name: model.name,
    model: model.id,
    base_url: provider.base_url,
    api_key_env: provider.api_key_env,
  };
  return currentEntry;
}

export async function getModel(): Promise<LanguageModelV3> {
  if (currentModel) return currentModel;
  const entry = getActiveEntry();
  currentModel = await buildModel(entry);
  return currentModel;
}

export function switchModel(id: string): SelectableModel {
  const cat = loadCatalog();
  const all = flattenModels(cat);
  const found = all.find((m) => m.id === id);
  if (!found) throw new Error(`Model "${id}" not found. Use /model to list.`);
  currentEntry = found;
  currentModel = null; // lazy rebuild on next getModel()
  return found;
}
