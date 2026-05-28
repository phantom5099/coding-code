import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { homedir } from 'os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
const DEFAULT_CONTEXT = {
    defaultMaxTokens: 200000,
    reservedTokens: 20000,
    thresholds: { prune: 0.7, compaction: 0.9 },
    pruneProtectedTokens: 40000,
    pruneMinRelease: 20000,
    toolsExemptFromPrune: ['Read', 'todo_write', 'todo_read', 'tool_search'],
    prefixTurnsProtected: 1,
    minTurnsBetweenCompactions: 5,
    keepRecentTurns: 10,
    compactionModel: '',
    archiveTtlDays: 30,
    checkpointKeep: 50,
    reactiveCompactMaxRetries: 1,
    reactiveCompactKeepTurns: 3,
    snipMaxMessages: 100,
    snipKeepHead: 3,
    microKeepRecentTools: 5,
    persistPreviewChars: 2000,
    thresholdTokens: 2000,
};
export const DEFAULT_MEMORY_TYPES = [
    { name: 'user', description: '用户角色、技能栈、工作偏好及对 Agent 的纠正', enabled: true },
    { name: 'project', description: '架构决策、技术选型、部署信息', enabled: true },
    { name: 'reference', description: '外部资源、文档、Dashboard 链接', enabled: true },
];
export const DEFAULT_MEMORY = {
    enabled: false,
    model: '',
    projectFile: '.codingcode/memory.md',
    userFile: '~/.codingcode/memory.md',
    maxBytes: 16384,
    promptMaxBytes: 8192,
    extraTypes: [],
    disabledTypes: [],
};
export const DEFAULT_CONFIG = {
    server: {
        port: 8080,
    },
    maxSteps: 50,
    maxStopContinuations: 2,
    context: DEFAULT_CONTEXT,
    memory: DEFAULT_MEMORY,
};
function deepMerge(base, override) {
    const result = { ...base };
    for (const key of Object.keys(override)) {
        const val = override[key];
        if (val !== undefined) {
            if (isObject(val) && isObject(result[key])) {
                result[key] = deepMerge(result[key], val);
            }
            else {
                result[key] = val;
            }
        }
    }
    return result;
}
function isObject(val) {
    return typeof val === 'object' && val !== null && !Array.isArray(val);
}
export function updateActiveModel(model, apiKeyEnv, configPath) {
    const p = configPath ?? getUserConfigPath();
    const existing = existsSync(p)
        ? parseYaml(readFileSync(p, 'utf8'))
        : {};
    existing.activeModel = { model, apiKeyEnv };
    writeFileSync(p, stringifyYaml(existing), 'utf8');
}
export function updateMemoryEnabled(enabled, configPath) {
    const p = configPath ?? getUserConfigPath();
    const existing = existsSync(p)
        ? parseYaml(readFileSync(p, 'utf8'))
        : {};
    const memory = existing.memory ?? {};
    existing.memory = { ...memory, enabled };
    writeFileSync(p, stringifyYaml(existing), 'utf8');
}
export function updateMemoryDisabledTypes(disabledTypes, configPath) {
    const p = configPath ?? getUserConfigPath();
    const existing = existsSync(p)
        ? parseYaml(readFileSync(p, 'utf8'))
        : {};
    const memory = existing.memory ?? {};
    existing.memory = { ...memory, disabledTypes };
    writeFileSync(p, stringifyYaml(existing), 'utf8');
}
export function updateMemoryExtraTypes(extraTypes, configPath) {
    const p = configPath ?? getUserConfigPath();
    const existing = existsSync(p)
        ? parseYaml(readFileSync(p, 'utf8'))
        : {};
    const memory = existing.memory ?? {};
    existing.memory = { ...memory, extraTypes };
    writeFileSync(p, stringifyYaml(existing), 'utf8');
}
export function loadConfig(configPath) {
    const p = configPath ?? getUserConfigPath();
    if (!existsSync(p))
        return DEFAULT_CONFIG;
    const parsed = parseYaml(readFileSync(p, 'utf8'));
    return deepMerge(DEFAULT_CONFIG, parsed);
}
export function getUserConfigPath() {
    return resolve(homedir(), '.codingcode', 'config.yaml');
}
export function ensureUserConfig() {
    const p = getUserConfigPath();
    if (existsSync(p))
        return;
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, stringifyYaml(DEFAULT_CONFIG), 'utf8');
}
