import { AgentError } from '../core/error';

export const LLMErrors = {
  timeout: (timeoutMs: number) => AgentError.llmTimeout(timeoutMs),
  failed: (cause?: unknown) => AgentError.llmFailed(cause),
  rateLimited: (retryAfter?: number) => new AgentError('LLM_RATE_LIMITED', `Rate limited${retryAfter ? `, retry after ${retryAfter}s` : ''}`, undefined, { retryAfter }),
};
