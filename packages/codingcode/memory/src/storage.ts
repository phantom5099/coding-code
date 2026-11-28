import * as fs from 'node:fs';
import * as path from 'node:path';
import { CODINGCODE_DIRNAME } from '@codingcode/util';

export function resolveMemoryPath(cwd: string): string {
  return path.join(cwd, CODINGCODE_DIRNAME, 'memory.md');
}

export function readMemoryFile(absPath: string): string {
  try {
    return fs.readFileSync(absPath, 'utf-8').trim();
  } catch {
    return '';
  }
}

export function writeMemoryFileAtomic(doc: {
  readonly path: string;
  readonly content: string;
}): void {
  const dir = path.dirname(doc.path);
  fs.mkdirSync(dir, { recursive: true });

  const tmpFile = doc.path + '.tmp';
  fs.writeFileSync(tmpFile, doc.content, 'utf-8');
  fs.renameSync(tmpFile, doc.path);
}

export function enforceMaxBytes(content: string, maxBytes: number): string {
  const contentBytes = Buffer.byteLength(content, 'utf-8');
  if (contentBytes <= maxBytes) {
    return content;
  }

  const sections = content.split(/^### /m).filter(Boolean);
  if (sections.length === 0) {
    return truncateByLines(content, maxBytes);
  }

  let result = '';
  for (const section of sections) {
    const candidate = result ? `${result}\n### ${section}` : `### ${section}`;
    if (Buffer.byteLength(candidate, 'utf-8') <= maxBytes) {
      result = candidate;
    } else {
      break;
    }
  }
  if (!result) {
    return truncateByLines(content, maxBytes);
  }
  return result.trim();
}

export function truncateByLines(content: string, maxBytes: number): string {
  if (Buffer.byteLength(content, 'utf-8') <= maxBytes) return content;
  let result = '';
  for (const line of content.split('\n')) {
    const candidate = result ? `${result}\n${line}` : line;
    if (Buffer.byteLength(candidate, 'utf-8') > maxBytes) {
      break;
    }
    result = candidate;
  }
  return result;
}
