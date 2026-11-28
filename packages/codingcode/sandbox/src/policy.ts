import { createHash } from 'node:crypto';
import { dirname, isAbsolute, resolve } from 'node:path';
import { normalizePath, stableJson, type PermissionMode } from '@codingcode/util';
import { isPathWithin } from './file-boundary.js';
import type {
  SandboxMode,
  SandboxNetworkPolicy,
  SandboxPolicy,
  SandboxPolicyContext,
  SandboxResolution,
} from './types.js';

const MODE_RANK: Record<SandboxMode, number> = {
  'read-only': 0,
  'workspace-write': 1,
  'danger-full-access': 2,
  unrestricted: 3,
};

function canonicalRoot(value: string): string | undefined {
  if (!value || !isAbsolute(value)) return undefined;
  return normalizePath(resolve(value));
}

function fingerprint(policy: Omit<SandboxPolicy, 'fingerprint'>): string {
  return createHash('sha256').update(stableJson(policy)).digest('hex');
}

function requestedMode(permissionMode: PermissionMode): SandboxMode {
  if (permissionMode === 'unrestricted') return 'unrestricted';
  if (permissionMode === 'bypass') return 'danger-full-access';
  return 'read-only';
}

function networkFor(context: SandboxPolicyContext, mode: SandboxMode): SandboxNetworkPolicy {
  if (mode === 'danger-full-access' || mode === 'unrestricted') {
    return { mode: 'unrestricted', hosts: [], ports: [] };
  }

  if (context.operation?.network) {
    return {
      mode: 'allowlist',
      hosts: [...context.operation.network.hosts].sort(),
      ports: [...context.operation.network.ports].sort((a, b) => a - b),
    };
  }

  return { mode: 'none', hosts: [], ports: [] };
}

export function resolveSandboxPolicy(context: SandboxPolicyContext): SandboxResolution {
  const workspaceRoot = canonicalRoot(context.projectPath);
  if (!workspaceRoot) return { kind: 'deny', reason: 'projectPath must be an absolute path' };

  const requested = context.requestedMode ?? requestedMode(context.permissionMode);
  const parent = context.parentPolicy;
  const requiresWrite = context.operation?.workspace?.write === true;
  const existingRoots = [
    workspaceRoot,
    ...(context.additionalWritableRoots ?? []).map(canonicalRoot).filter((v): v is string => !!v),
  ];
  const outsideWritePaths = (context.operation?.workspace?.paths ?? [])
    .map((path) => resolve(workspaceRoot, path))
    .filter((path) => !existingRoots.some((root) => isPathWithin(root, path)));
  if (
    outsideWritePaths.length > 0 &&
    context.permissionMode !== 'askBeforeExec' &&
    context.permissionMode !== 'unrestricted'
  ) {
    return { kind: 'deny', reason: 'write target is outside the sandbox roots' };
  }
  const escalation =
    requiresWrite &&
    requested === 'read-only' &&
    context.permissionMode === 'askBeforeExec';
  const mode = escalation ? 'workspace-write' : requested;
  if (parent && MODE_RANK[mode] > MODE_RANK[parent.mode]) {
    return { kind: 'deny', reason: `sandbox mode ${mode} exceeds parent mode ${parent.mode}` };
  }
  const additionalWritableRoots = [
    ...(context.additionalWritableRoots ?? []),
    ...outsideWritePaths.map((path) => dirname(path)),
  ]
    .map(canonicalRoot)
    .filter((value): value is string => value !== undefined)
    .sort();
  const policyWithoutFingerprint: Omit<SandboxPolicy, 'fingerprint'> = {
    mode,
    workspaceRoot,
    additionalWritableRoots,
    network: networkFor(context, mode),
    sessionId: context.sessionId,
    enforcement: mode === 'read-only' || mode === 'workspace-write' ? 'required' : 'disabled',
  };

  const policy = { ...policyWithoutFingerprint, fingerprint: fingerprint(policyWithoutFingerprint) };
  if (escalation) {
    return {
      kind: 'escalation',
      policy,
      request: {
        currentMode: 'read-only',
        targetMode: 'workspace-write',
        sessionId: context.sessionId,
        workspaceRoot,
        call: context.call ?? { callId: '', toolName: '', argsHash: '' },
        justification: 'This tool call writes to the workspace.',
        additionalWritableRoots,
      },
    };
  }
  return { kind: 'ready', policy };
}
