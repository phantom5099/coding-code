import * as fs from 'node:fs';
import * as path from 'node:path';

export function resolveMemoryPath(cwd: string): string {
  return path.join(cwd, '.codingcode', 'memory.md');
}

export function readMemoryFile(absPath: string): string {
  try {
    return fs.readFileSync(absPath, 'utf-8').trim();
  } catch {
    return '';
  }
}

export function writeMemoryFileAtomic(absPath: string, content: string): void {
  const dir = path.dirname(absPath);
  fs.mkdirSync(dir, { recursive: true });

  const tmpFile = absPath + '.tmp';
  fs.writeFileSync(tmpFile, content, 'utf-8');
  fs.renameSync(tmpFile, absPath);
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
  // 首个小节即超限时退化为按行截断，避免整份清空
  if (!result) {
    return truncateByLines(content, maxBytes);
  }
  return result.trim();
}

function truncateByLines(content: string, maxBytes: number): string {
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
