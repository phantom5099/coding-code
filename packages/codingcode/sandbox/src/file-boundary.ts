import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { AgentError } from '@codingcode/util';
import type { FileTarget, SandboxPolicy } from './types.js';

export function isPathWithin(root: string, target: string): boolean {
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
  target: FileTarget
): Promise<string> {
  const { path: input, operation } = target;
  if (!input || input.includes('\0'))
    throw new AgentError('SANDBOX_PATH_DENIED', 'Invalid file path');
  const requested = isAbsolute(input) ? input : resolve(policy.workspaceRoot, input);
  if (policy.mode === 'unrestricted' || policy.mode === 'danger-full-access') return requested;

  const resolved = await canonicalTarget(requested);
  const roots = [policy.workspaceRoot, ...policy.additionalWritableRoots];
  if (!roots.some((root) => isPathWithin(root, resolved))) {
    throw new AgentError('SANDBOX_PATH_DENIED', `Path is outside the sandbox roots: ${input}`);
  }
  if (operation === 'write' && policy.mode === 'read-only') {
    throw new AgentError('SANDBOX_PATH_DENIED', 'The current sandbox is read-only');
  }
  return resolved;
}
