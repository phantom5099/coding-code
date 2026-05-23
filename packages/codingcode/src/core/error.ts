export type ErrorCode =
  | 'LLM_TIMEOUT'
  | 'LLM_RATE_LIMITED'
  | 'LLM_FAILED'
  | 'CONTEXT_OVERFLOW'
  | 'TOOL_NOT_FOUND'
  | 'TOOL_NOT_ALLOWED'
  | 'TOOL_EXECUTION_FAILED'
  | 'PATH_NOT_ALLOWED'
  | 'MAX_STEPS_REACHED'
  | 'CONFIG_MISSING'
  | 'CONFIG_INVALID'
  | 'SESSION_CORRUPTED'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_WORKSPACE_MISMATCH'
  | 'AGENT_ABORTED'
  | 'STOP_LOOP';

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

  static llmTimeout() { return new AgentError('LLM_TIMEOUT', 'LLM call timed out'); }
  static llmFailed(msg: unknown) { return new AgentError('LLM_FAILED', String(msg)); }
  static contextOverflow(provider: string, cause?: unknown) { return new AgentError('CONTEXT_OVERFLOW', `Context window exceeded for ${provider}`, cause); }
  static toolNotFound(name: string) { return new AgentError('TOOL_NOT_FOUND', `Tool "${name}" not found`); }
  static toolNotAllowed(name: string) { return new AgentError('TOOL_NOT_ALLOWED', `Tool "${name}" is not allowed`); }
  static toolExecutionFailed(name: string, e: unknown) { return new AgentError('TOOL_EXECUTION_FAILED', `Tool "${name}" failed: ${String(e)}`, e); }
  static pathNotAllowed(path: string) { return new AgentError('PATH_NOT_ALLOWED', `Path "${path}" is outside allowed scope`); }
  static maxStepsReached(max: number) { return new AgentError('MAX_STEPS_REACHED', `Max steps (${max}) reached`); }
  static configMissing(msg: string) { return new AgentError('CONFIG_MISSING', msg); }
  static sessionNotFound(sessionId: string) {
    return new AgentError('SESSION_NOT_FOUND', `Session "${sessionId}" not found`);
  }
  static sessionWorkspaceMismatch(sessionId: string, expectedCwd: string) {
    return new AgentError(
      'SESSION_WORKSPACE_MISMATCH',
      `Session "${sessionId}" belongs to a different project. cd to: ${expectedCwd}`,
      undefined,
      { sessionId, expectedCwd },
    );
  }
}
