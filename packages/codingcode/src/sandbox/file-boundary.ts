import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { AgentError } from '../util/error.js';
import type { SandboxPolicy } from './types.js';

function contains(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

async function canonicalTarget(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    const missing: string[] = [];
    let current = path;
    while (true) {
      try {
        const existing = await realpath(current);
        return resolve(existing, ...missing.reverse());
      } catch {
        const parent = dirname(current);
        if (parent === current)
          throw new AgentError('SANDBOX_PATH_DENIED', `Path cannot be resolved: ${path}`);
        missing.push(current.slice(parent.length + 1));
        current = parent;
      }
    }
  }
}

export async function resolveFileTarget(
  policy: SandboxPolicy,
  input: string,
  operation: 'read' | 'write'
): Promise<string> {
  if (!input || input.includes('\0'))
    throw new AgentError('SANDBOX_PATH_DENIED', 'Invalid file path');
  const requested = isAbsolute(input) ? input : resolve(policy.workspaceRoot, input);
  if (policy.mode === 'unrestricted' || policy.mode === 'danger-full-access') return requested;

  const target = await canonicalTarget(requested);
  const roots = [policy.workspaceRoot, ...policy.additionalWritableRoots];
  if (!roots.some((root) => contains(root, target))) {
    throw new AgentError('SANDBOX_PATH_DENIED', `Path is outside the sandbox roots: ${input}`);
  }
  if (operation === 'write' && policy.mode === 'read-only') {
    throw new AgentError('SANDBOX_PATH_DENIED', 'The current sandbox is read-only');
  }
  return target;
}
