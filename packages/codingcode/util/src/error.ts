export type ErrorCode =
  | 'LLM_TIMEOUT'
  | 'LLM_RATE_LIMITED'
  | 'LLM_FAILED'
  | 'CONTEXT_OVERFLOW'
  | 'TOOL_NOT_FOUND'
  | 'TOOL_NOT_ALLOWED'
  | 'TOOL_EXECUTION_FAILED'
  | 'MAX_STEPS_REACHED'
  | 'CONFIG_MISSING'
  | 'CONFIG_INVALID'
  | 'SESSION_CORRUPTED'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_WORKSPACE_MISMATCH'
  | 'AGENT_ABORTED'
  | 'AGENT_TERMINATED'
  | 'AGENT_LOOP_DETECTED'
  | 'SUBAGENT_FAILED'
  | 'EMPTY_RESPONSE'
  | 'SESSION_IO_ERROR'
  | 'INVALID_INPUT'
  | 'TURN_CONFLICT'
  | 'SANDBOX_UNAVAILABLE'
  | 'SANDBOX_PATH_DENIED'
  | 'SANDBOX_NETWORK_DENIED'
  | 'SANDBOX_POLICY_DENIED';

export interface AgentErrorOptions {
  readonly cause?: unknown;
  readonly context?: Readonly<Record<string, unknown>>;
}

export class AgentError extends Error {
  readonly _tag = 'AgentError';
  public readonly cause?: unknown;
  public readonly context?: Readonly<Record<string, unknown>>;

  constructor(
    public readonly code: ErrorCode,
    message: string,
    opts?: AgentErrorOptions
  ) {
    super(`[${code}] ${message}`);
    this.name = 'AgentError';
    this.cause = opts?.cause;
    this.context = opts?.context;
  }

  static llmTimeout(timeoutMs?: number) {
    const detail = timeoutMs !== undefined ? ` after ${timeoutMs}ms` : '';
    return new AgentError('LLM_TIMEOUT', `LLM call timed out${detail}`);
  }
  static llmFailed(msg: unknown) {
    return new AgentError('LLM_FAILED', String(msg));
  }
  static contextOverflow(provider: string, cause?: unknown) {
    return new AgentError('CONTEXT_OVERFLOW', `Context window exceeded for ${provider}`, { cause });
  }
  static toolNotFound(name: string) {
    return new AgentError('TOOL_NOT_FOUND', `Tool "${name}" not found`);
  }
  static toolNotAllowed(name: string) {
    return new AgentError('TOOL_NOT_ALLOWED', `Tool "${name}" is not allowed`);
  }
  static toolExecutionFailed(name: string, cause: unknown) {
    return new AgentError('TOOL_EXECUTION_FAILED', `Tool "${name}" failed: ${String(cause)}`, {
      cause,
    });
  }
  static maxStepsReached(max: number) {
    return new AgentError('MAX_STEPS_REACHED', `Max steps (${max}) reached`);
  }
  static configMissing(msg: string) {
    return new AgentError('CONFIG_MISSING', msg);
  }
  static invalidInput(msg: string) {
    return new AgentError('INVALID_INPUT', msg);
  }
  static sessionNotFound(sessionId: string) {
    return new AgentError('SESSION_NOT_FOUND', `Session "${sessionId}" not found`);
  }
  static sessionWorkspaceMismatch(mismatch: { readonly sessionId: string; readonly expectedCwd: string }) {
    return new AgentError(
      'SESSION_WORKSPACE_MISMATCH',
      `Session "${mismatch.sessionId}" belongs to a different project. cd to: ${mismatch.expectedCwd}`,
      { context: { sessionId: mismatch.sessionId, expectedCwd: mismatch.expectedCwd } }
    );
  }
}
