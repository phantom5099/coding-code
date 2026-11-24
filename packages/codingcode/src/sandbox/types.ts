export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access' | 'unrestricted';

export type SandboxNetworkMode = 'none' | 'allowlist' | 'unrestricted';

export type DangerousOperation =
  | 'workspace_escape'
  | 'destructive_delete'
  | 'permission_change'
  | 'process_control'
  | 'credential_access'
  | 'network_unrestricted'
  | 'remote_code_fetch'
  | 'repository_history_write'
  | 'system_configuration';

export interface SandboxPolicy {
  readonly mode: SandboxMode;
  readonly workspaceRoot: string;
  readonly additionalWritableRoots: readonly string[];
  readonly network: {
    readonly mode: SandboxNetworkMode;
    readonly hosts: readonly string[];
    readonly ports: readonly number[];
  };
  readonly sessionId: string;
  readonly enforcement: 'required' | 'best-effort' | 'disabled';
  readonly fingerprint: string;
}

export interface SandboxPolicyContext {
  readonly projectPath: string;
  readonly sessionId: string;
  readonly permissionMode: string;
  readonly requestedMode?: SandboxMode;
  readonly operation?: import('../tools/types.js').ToolApprovalMetadata;
  readonly parsedArgs?: unknown;
  readonly parentPolicy?: SandboxPolicy;
  readonly additionalWritableRoots?: readonly string[];
  readonly callId?: string;
  readonly toolName?: string;
  readonly argsHash?: string;
}

export interface SandboxEscalationRequest {
  readonly currentMode: SandboxMode;
  readonly targetMode: SandboxMode;
  readonly sessionId: string;
  readonly callId: string;
  readonly toolName: string;
  readonly argsHash: string;
  readonly justification: string;
  readonly additionalWritableRoots?: readonly string[];
}

export type SandboxResolution =
  | { readonly kind: 'ready'; readonly policy: SandboxPolicy }
  | {
      readonly kind: 'escalation';
      readonly request: SandboxEscalationRequest;
      readonly policy: SandboxPolicy;
    }
  | { readonly kind: 'deny'; readonly reason: string };

export interface ConfinedCommand {
  readonly argv: readonly string[];
  readonly enforcement: 'full' | 'partial' | 'disabled';
  readonly runner: 'bwrap' | 'seatbelt' | 'windows' | 'none';
}
