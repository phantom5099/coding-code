export interface ContextThresholdsConfig {
    prune: number;
    compaction: number;
}
export interface ContextConfig {
    defaultMaxTokens: number;
    reservedTokens: number;
    thresholds: ContextThresholdsConfig;
    pruneProtectedTokens: number;
    pruneMinRelease: number;
    toolsExemptFromPrune: string[];
    prefixTurnsProtected: number;
    minTurnsBetweenCompactions: number;
    keepRecentTurns: number;
    /** Model for context compaction. Empty string falls back to main session LLM.
     *  Use full id format "model@API_KEY_ENV" to avoid ambiguity (e.g. "deepseek-chat@DEEPSEEK_API_KEY").
     *  Can also use bare model id (e.g. "deepseek-chat") or display name, first match wins. */
    compactionModel: string;
    archiveTtlDays: number;
    checkpointKeep: number;
    thresholdTokens: number;
    reactiveCompactMaxRetries: number;
    reactiveCompactKeepTurns: number;
    snipMaxMessages: number;
    snipKeepHead: number;
    microKeepRecentTools: number;
    persistPreviewChars: number;
}
export interface MemoryTypeConfig {
    name: string;
    description: string;
    enabled: boolean;
}
export interface MemoryConfig {
    enabled: boolean;
    /** Model for memory operations. Empty string falls back to main session LLM.
     *  Use full id format "model@API_KEY_ENV" to avoid ambiguity (e.g. "deepseek-chat@DEEPSEEK_API_KEY").
     *  Can also use bare model id (e.g. "deepseek-chat") or display name, first match wins. */
    model: string;
    projectFile: string;
    userFile: string;
    maxBytes: number;
    promptMaxBytes: number;
    extraTypes: MemoryTypeConfig[];
    disabledTypes: string[];
}
export interface ActiveModelConfig {
    model: string;
    apiKeyEnv: string;
}
export interface AppConfig {
    server: {
        port: number;
    };
    maxSteps: number;
    maxStopContinuations: number;
    activeModel?: ActiveModelConfig;
    context: ContextConfig;
    memory: MemoryConfig;
}
export declare const DEFAULT_MEMORY_TYPES: MemoryTypeConfig[];
export declare const DEFAULT_MEMORY: MemoryConfig;
export declare const DEFAULT_CONFIG: AppConfig;
export declare function updateActiveModel(model: string, apiKeyEnv: string, configPath?: string): void;
export declare function updateMemoryEnabled(enabled: boolean, configPath?: string): void;
export declare function updateMemoryDisabledTypes(disabledTypes: string[], configPath?: string): void;
export declare function updateMemoryExtraTypes(extraTypes: MemoryTypeConfig[], configPath?: string): void;
export declare function loadConfig(configPath?: string): AppConfig;
export declare function getUserConfigPath(): string;
export declare function ensureUserConfig(): void;
