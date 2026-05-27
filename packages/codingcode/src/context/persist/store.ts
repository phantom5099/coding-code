import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface PersistResult {
  path: string;
  bytes: number;
}

export function persistToolResult(
  projectBase: string,
  encodedProjectPath: string,
  sessionId: string,
  toolCallId: string,
  content: string,
): PersistResult {
  const dir = join(projectBase, encodedProjectPath, 'tool-results', sessionId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = join(dir, `${toolCallId}.txt`);
  if (!existsSync(file)) {
    writeFileSync(file, content, 'utf8');
  }
  return { path: file.replace(/\\/g, '/'), bytes: Buffer.byteLength(content, 'utf8') };
}
