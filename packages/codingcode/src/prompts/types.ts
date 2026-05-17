/** 当前支持的 Agent 角色 */
export type AgentRole = "coder" | "debugger" | "reviewer";

/** 环境变量，用于注入到提示词模板中 */
export interface EnvVars {
  cwd: string;
  platform: string;
  shell: string;
}

/** 每个角色的完整配置 */
export interface PromptSet {
  /** 角色展示名 */
  label: string;
  /** 简短描述 */
  description: string;
  /** 构建 system prompt 的函数 */
  buildSystem: (env: EnvVars) => string;
  /** 该角色可用的工具名列表 */
  toolNames: string[];
  /** 最大 tool-call 步数 */
  maxSteps?: number;
}
