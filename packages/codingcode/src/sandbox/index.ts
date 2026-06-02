// Sandbox module — reserved for future OS-level runtime isolation.

export interface SandboxConfig {
  allowedDomains?: string[];
  deniedDomains?: string[];
  allowReadPaths?: string[];
  allowWritePaths?: string[];
  denyReadPaths?: string[];
  denyWritePaths?: string[];
  allowUnixSockets?: string[];
  defaultTimeoutMs?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ExecuteOptions {
  command: string;
  timeoutMs?: number;
}

/** Stub service — re-implement here when a real sandbox runtime is integrated. */
export class SandboxService {}
