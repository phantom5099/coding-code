import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { normalizePath } from '../core/path.js';

export function shortSid(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 8);
}

export function commitMsg(sessionId: string, turnId: number, suffix: string): string {
  return `turn-${shortSid(sessionId)}-${turnId}-${suffix}`;
}

export function toGitPath(projectPath: string, file: string): string {
  const normalized = normalizePath(file);
  const base = normalizePath(projectPath);
  if (normalized.toLowerCase().startsWith(base.toLowerCase())) {
    let rel = normalized.slice(base.length);
    if (rel.startsWith('/') || rel.startsWith('\\')) rel = rel.slice(1);
    return rel;
  }
  return normalized;
}

export function hashWorkspaceFile(projectPath: string, file: string): string | null {
  try {
    const content = readFileSync(resolve(projectPath, toGitPath(projectPath, file)));
    return createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
}
