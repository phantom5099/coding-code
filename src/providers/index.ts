import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// ─── Types ────────────────────────────────────────────

export interface ModelEntry {
  id: string;
  name: string;
  model: string;
  base_url: string;
  api_key_env: string;
}

interface ModelCatalog {
  active: string;
  models: ModelEntry[];
}

// ─── State ────────────────────────────────────────────

const MODELS_FILE = resolve(process.cwd(), "models.json");

let catalog: ModelCatalog | null = null;
let currentModelEntry: ModelEntry | null = null;
let currentModel: LanguageModelV3 | null = null;

// ─── Load ─────────────────────────────────────────────

function loadCatalog(): ModelCatalog {
  if (catalog) return catalog;
  if (!existsSync(MODELS_FILE)) {
    throw new Error(`models.json not found at ${MODELS_FILE}`);
  }
  const raw = readFileSync(MODELS_FILE, "utf-8");
  catalog = JSON.parse(raw) as ModelCatalog;
  if (!catalog.models || catalog.models.length === 0) {
    throw new Error("models.json has no models defined");
  }
  return catalog;
}

function resolveApiKey(entry: ModelEntry): string {
  return process.env[entry.api_key_env] || process.env.OPENAI_API_KEY || "";
}

// ─── Build model ──────────────────────────────────────

function buildModel(entry: ModelEntry): LanguageModelV3 {
  const apiKey = resolveApiKey(entry);
  const provider = createOpenAI({
    name: entry.id,
    baseURL: entry.base_url,
    apiKey,
  });
  return provider(entry.model) as LanguageModelV3;
}

// ─── Public API ───────────────────────────────────────

export function listModels(): ModelEntry[] {
  return loadCatalog().models;
}

export function getActiveEntry(): ModelEntry {
  if (currentModelEntry) return currentModelEntry;
  const cat = loadCatalog();
  const activeId = cat.active;
  const found = cat.models.find((m) => m.id === activeId);
  if (!found) throw new Error(`Active model "${activeId}" not found in models.json`);
  currentModelEntry = found;
  currentModel = buildModel(found);
  return found;
}

export function getModel(): LanguageModelV3 {
  if (currentModel) return currentModel;
  getActiveEntry();
  return currentModel!;
}

export function switchModel(id: string): ModelEntry {
  const cat = loadCatalog();
  const found = cat.models.find((m) => m.id === id);
  if (!found) throw new Error(`Model "${id}" not found. Use /models to list.`);
  currentModelEntry = found;
  currentModel = buildModel(found);
  return found;
}
