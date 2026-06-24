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
  | 'AGENT_LOOP_DETECTED'
  | 'SESSION_IO_ERROR';

export class AlreadyExistsError extends Error {
  readonly code = 'ALREADY_EXISTS';
  constructor(message: string) {
    super(message);
    this.name = 'AlreadyExistsError';
  }
  httpStatus(): 409 {
    return 409;
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly body?: { code: string; message: string }
  ) {
    super(body?.message ?? `HTTP ${status}: ${path}`);
    this.name = 'ApiError';
  }
}

export class NotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
  httpStatus(): 404 {
    return 404;
  }
}

export class AgentError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly cause?: unknown,
    public readonly context?: Record<string, unknown>
  ) {
    super(`[${code}] ${message}`);
    this.name = 'AgentError';
  }

  static llmTimeout() {
    return new AgentError('LLM_TIMEOUT', 'LLM call timed out');
  }
  static llmFailed(msg: unknown) {
    return new AgentError('LLM_FAILED', String(msg));
  }
  static contextOverflow(provider: string, cause?: unknown) {
    return new AgentError('CONTEXT_OVERFLOW', `Context window exceeded for ${provider}`, cause);
  }
  static toolNotFound(name: string) {
    return new AgentError('TOOL_NOT_FOUND', `Tool "${name}" not found`);
  }
  static toolNotAllowed(name: string) {
    return new AgentError('TOOL_NOT_ALLOWED', `Tool "${name}" is not allowed`);
  }
  static toolExecutionFailed(name: string, e: unknown) {
    return new AgentError('TOOL_EXECUTION_FAILED', `Tool "${name}" failed: ${String(e)}`, e);
  }
  static pathNotAllowed(path: string) {
    return new AgentError('PATH_NOT_ALLOWED', `Path "${path}" is outside allowed scope`);
  }
  static maxStepsReached(max: number) {
    return new AgentError('MAX_STEPS_REACHED', `Max steps (${max}) reached`);
  }
  static configMissing(msg: string) {
    return new AgentError('CONFIG_MISSING', msg);
  }
  static sessionNotFound(sessionId: string) {
    return new AgentError('SESSION_NOT_FOUND', `Session "${sessionId}" not found`);
  }
  static sessionWorkspaceMismatch(sessionId: string, expectedCwd: string) {
    return new AgentError(
      'SESSION_WORKSPACE_MISMATCH',
      `Session "${sessionId}" belongs to a different project. cd to: ${expectedCwd}`,
      undefined,
      { sessionId, expectedCwd }
    );
  }

  httpStatus(): number {
    switch (this.code) {
      case 'CONFIG_MISSING':
      case 'CONFIG_INVALID':
        return 400;
      case 'SESSION_NOT_FOUND':
        return 404;
      case 'SESSION_WORKSPACE_MISMATCH':
        return 409;
      case 'TOOL_NOT_ALLOWED':
        return 403;
      case 'LLM_RATE_LIMITED':
        return 429;
      default:
        return 500;
    }
  }
}
