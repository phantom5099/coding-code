import { resolve } from 'node:path';
import type { SandboxMode, SandboxPolicy } from '../../src/sandbox/types.js';

export function testSandboxPolicy(
  workspaceRoot: string,
  mode: SandboxMode = 'unrestricted'
): SandboxPolicy {
  return {
    mode,
    workspaceRoot: resolve(workspaceRoot),
    additionalWritableRoots: [],
    network: {
      mode: mode === 'read-only' || mode === 'workspace-write' ? 'none' : 'unrestricted',
      hosts: [],
      ports: [],
    },
    sessionId: 'test-session',
    enforcement: mode === 'read-only' || mode === 'workspace-write' ? 'required' : 'disabled',
    fingerprint: 'test',
  };
}
