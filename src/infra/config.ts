export const config = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  OPENAI_MODEL: process.env.OPENAI_MODEL || "gpt-4o",
  MAX_STEPS: Number(process.env.MAX_STEPS) || 25,
  LLM_TIMEOUT_MS: Number(process.env.LLM_TIMEOUT_MS) || 120000,
  TOOL_TIMEOUT_MS: Number(process.env.TOOL_TIMEOUT_MS) || 30000,
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
} as const;
