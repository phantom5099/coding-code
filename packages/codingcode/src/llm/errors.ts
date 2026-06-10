import { AgentError } from '../core/error.js';

export const LLMErrors = {
  timeout: (timeoutMs: number) => AgentError.llmTimeout(),
  failed: (cause?: unknown) =>
    AgentError.llmFailed(typeof cause === 'string' ? cause : String(cause ?? '')),
  rateLimited: (retryAfter?: number) =>
    new AgentError(
      'LLM_RATE_LIMITED',
      `Rate limited${retryAfter ? `, retry after ${retryAfter}s` : ''}`
    ),
};

export function mapLlmError(provider: string, e: unknown): AgentError {
  const err = e as any;
  const msg = String(err?.message ?? err ?? '');
  const status = err?.statusCode ?? err?.status;
  const code = err?.code ?? err?.data?.error?.code;

  const isOverflow =
    status === 413 ||
    code === 'context_length_exceeded' ||
    /context (length|window)|prompt.*too long|maximum context/i.test(msg);

  return isOverflow ? AgentError.contextOverflow(provider, e) : AgentError.llmFailed(e);
}
