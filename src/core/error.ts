export type ErrorCode =
  | 'LLM_TIMEOUT'
  | 'LLM_RATE_LIMITED'
  | 'LLM_FAILED'
  | 'TOOL_NOT_FOUND'
  | 'TOOL_NOT_ALLOWED'
  | 'TOOL_EXECUTION_FAILED'
  | 'PATH_NOT_ALLOWED'
  | 'MAX_STEPS_REACHED'
  | 'CONFIG_MISSING'
  | 'CONFIG_INVALID'
  | 'SESSION_CORRUPTED';

export class AgentError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly cause?: unknown,
    public readonly context?: Record<string, unknown>,
  ) {
    super(`[${code}] ${message}`);
    this.name = 'AgentError';
  }

  static llmTimeout(timeoutMs: number): AgentError {
    return new AgentError('LLM_TIMEOUT', `LLM call exceeded ${timeoutMs}ms`, undefined, { timeoutMs });
  }

  static llmFailed(cause?: unknown): AgentError {
    return new AgentError('LLM_FAILED', 'LLM call failed', cause);
  }

  static toolNotFound(name: string): AgentError {
    return new AgentError('TOOL_NOT_FOUND', `Tool "${name}" not registered`, undefined, { toolName: name });
  }

  static toolNotAllowed(name: string): AgentError {
    return new AgentError('TOOL_NOT_ALLOWED', `Tool "${name}" is not allowed`, undefined, { toolName: name });
  }

  static toolExecutionFailed(name: string, cause?: unknown): AgentError {
    return new AgentError('TOOL_EXECUTION_FAILED', `Tool "${name}" execution failed`, cause, { toolName: name });
  }

  static configMissing(path: string): AgentError {
    return new AgentError('CONFIG_MISSING', `Configuration file not found: ${path}`, undefined, { path });
  }

  static maxStepsReached(max: number): AgentError {
    return new AgentError('MAX_STEPS_REACHED', `Maximum steps (${max}) reached`, undefined, { maxSteps: max });
  }
}
