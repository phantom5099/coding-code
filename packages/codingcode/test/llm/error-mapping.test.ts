import { describe, it, expect } from 'vitest';
import { mapLlmError } from '../../src/llm/errors.js';
import { AgentError } from '../../src/core/error.js';

describe('mapLlmError', () => {
  it('should map 413 status to CONTEXT_OVERFLOW', () => {
    const err = new Error('Request failed');
    (err as any).status = 413;

    const result = mapLlmError('openai', err);
    expect(result.code).toBe('CONTEXT_OVERFLOW');
    expect(result.message).toContain('openai');
  });

  it('should map context_length_exceeded code to CONTEXT_OVERFLOW', () => {
    const err = new Error('Model error');
    (err as any).code = 'context_length_exceeded';

    const result = mapLlmError('deepseek', err);
    expect(result.code).toBe('CONTEXT_OVERFLOW');
  });

  it('should map "prompt too long" message to CONTEXT_OVERFLOW', () => {
    const err = new Error('Your prompt is too long for this model');

    const result = mapLlmError('anthropic', err);
    expect(result.code).toBe('CONTEXT_OVERFLOW');
  });

  it('should map "maximum context" message to CONTEXT_OVERFLOW', () => {
    const err = new Error('Request exceeds maximum context length');

    const result = mapLlmError('openai', err);
    expect(result.code).toBe('CONTEXT_OVERFLOW');
  });

  it('should map "context window" message to CONTEXT_OVERFLOW', () => {
    const err = new Error('Input exceeds context window size');

    const result = mapLlmError('deepseek', err);
    expect(result.code).toBe('CONTEXT_OVERFLOW');
  });

  it('should map 413 in statusCode field', () => {
    const err = new Error('Too large');
    (err as any).statusCode = 413;

    const result = mapLlmError('custom', err);
    expect(result.code).toBe('CONTEXT_OVERFLOW');
  });

  it('should map other errors to LLM_FAILED', () => {
    const err = new Error('Rate limited');
    (err as any).status = 429;

    const result = mapLlmError('openai', err);
    expect(result.code).toBe('LLM_FAILED');
  });

  it('should map generic errors to LLM_FAILED', () => {
    const err = new Error('Unknown error');

    const result = mapLlmError('any-provider', err);
    expect(result.code).toBe('LLM_FAILED');
  });

  it('should include provider name in CONTEXT_OVERFLOW message', () => {
    const err = new Error('prompt too long');

    const result = mapLlmError('my-provider', err);
    expect(result.message).toContain('my-provider');
  });

  it('should preserve original error as cause', () => {
    const originalErr = new Error('Original context error');
    (originalErr as any).status = 413;

    const result = mapLlmError('openai', originalErr);
    expect(result.cause).toBe(originalErr);
  });
});
