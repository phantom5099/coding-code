import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PROJECT_BASE = join(homedir(), '.codingcode', 'project');

export interface PersistResult {
  path: string;
  bytes: number;
}

export function persistToolResult(
  encodedProjectPath: string,
  sessionId: string,
  toolCallId: string,
  content: string,
): PersistResult {
  const dir = join(PROJECT_BASE, encodedProjectPath, 'tool-results', sessionId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = join(dir, `${toolCallId}.txt`);
  if (!existsSync(file)) {
    writeFileSync(file, content, 'utf8');
  }
  return { path: file.replace(/\\/g, '/'), bytes: Buffer.byteLength(content, 'utf8') };
}
