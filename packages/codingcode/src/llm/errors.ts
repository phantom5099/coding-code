import { AgentError } from '../core/error';

export const LLMErrors = {
  timeout: (timeoutMs: number) => AgentError.llmTimeout(),
  failed: (cause?: unknown) => AgentError.llmFailed(typeof cause === 'string' ? cause : String(cause ?? '')),
  rateLimited: (retryAfter?: number) => new AgentError('LLM_RATE_LIMITED', `Rate limited${retryAfter ? `, retry after ${retryAfter}s` : ''}`),
};
