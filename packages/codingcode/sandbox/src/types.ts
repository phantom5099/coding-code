import type { ApprovalAction, PermissionMode } from '@codingcode/util';

export interface ToolApprovalMetadata {
  readonly action: ApprovalAction;
  readonly requiresConfirmation?: boolean;
  readonly dangerous?: readonly DangerousOperation[];
  readonly network?: { readonly hosts: readonly string[]; readonly ports: readonly number[] };
  readonly workspace?: { readonly paths: readonly string[]; readonly write: boolean };
}

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access' | 'unrestricted';

export type SandboxNetworkMode = 'none' | 'allowlist' | 'unrestricted';

export interface SandboxNetworkPolicy {
  readonly mode: SandboxNetworkMode;
  readonly hosts: readonly string[];
  readonly ports: readonly number[];
}

export type SandboxEnforcement = 'required' | 'best-effort' | 'disabled';
export type CommandEnforcement = 'full' | 'partial' | 'disabled';
export type SandboxRunner = 'bwrap' | 'seatbelt' | 'windows' | 'none';
export type FileAccessMode = 'read' | 'write';

export interface FileTarget {
  readonly path: string;
  readonly operation: FileAccessMode;
}

export interface NetworkTarget {
  readonly host: string;
  readonly port: number;
}

export interface SandboxCallRef {
  readonly callId: string;
  readonly toolName: string;
  readonly argsHash: string;
}

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
  readonly network: SandboxNetworkPolicy;
  readonly sessionId: string;
  readonly enforcement: SandboxEnforcement;
  readonly fingerprint: string;
}

/** 回合/工具批级沙箱配置值对象 */
export interface SandboxConfig {
  readonly mode?: SandboxMode;
  readonly policy?: SandboxPolicy;
}

export interface SandboxPolicyContext {
  readonly projectPath: string;
  readonly sessionId: string;
  readonly permissionMode: PermissionMode;
  readonly requestedMode?: SandboxMode;
  readonly operation?: ToolApprovalMetadata;
  readonly parentPolicy?: SandboxPolicy;
  readonly additionalWritableRoots?: readonly string[];
  readonly call?: SandboxCallRef;
}

export interface SandboxEscalationRequest {
  readonly currentMode: SandboxMode;
  readonly targetMode: SandboxMode;
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly call: SandboxCallRef;
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
  readonly enforcement: CommandEnforcement;
  readonly runner: SandboxRunner;
}
