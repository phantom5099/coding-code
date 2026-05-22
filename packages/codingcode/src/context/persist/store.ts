import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = '.codingcode/tool-results';

export interface PersistResult {
  path: string;
  bytes: number;
}

export function persistToolResult(
  sessionId: string,
  toolCallId: string,
  content: string,
  cwd: string = process.cwd(),
): PersistResult {
  const dir = join(cwd, ROOT, sessionId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = join(dir, `${toolCallId}.txt`);
  if (!existsSync(file)) {
    writeFileSync(file, content, 'utf8');
  }
  const relativePath = join(ROOT, sessionId, `${toolCallId}.txt`).replace(/\\/g, '/');
  return { path: relativePath, bytes: Buffer.byteLength(content, 'utf8') };
}
