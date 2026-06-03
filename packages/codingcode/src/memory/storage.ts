import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { MemoryConfig } from '@codingcode/infra';

// ── Path Resolution ──

export function resolveProjectMemoryPath(cwd: string, cfg: MemoryConfig): string {
  const filePath = cfg.projectFile;
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.join(cwd, filePath);
}

export function resolveUserMemoryPath(cfg: MemoryConfig): string {
  const filePath = cfg.userFile;
  if (filePath.startsWith('~')) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.join(os.homedir(), filePath);
}

// ── File Read/Write ──

export function readMemoryFile(absPath: string): string {
  try {
    return fs.readFileSync(absPath, 'utf-8').trim();
  } catch {
    return '';
  }
}

export function extractAutoBlock(content: string): string {
  const match = content.match(/<!-- auto:begin -->([\s\S]*?)<!-- auto:end -->/);
  return match ? match[1]!.trim() : '';
}

export function replaceAutoBlock(content: string, newAutoInner: string): string {
  const marker = '<!-- auto:begin -->';
  const endMarker = '<!-- auto:end -->';

  if (content.includes(marker) && content.includes(endMarker)) {
    return content.replace(
      new RegExp(
        `${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${endMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
      ),
      `${marker}\n${newAutoInner}\n${endMarker}`
    );
  }

  return `${marker}\n${newAutoInner}\n${endMarker}`;
}

export function stripMarkersForPrompt(content: string): string {
  return content
    .replace(/<!-- auto:begin -->\n?/g, '')
    .replace(/\n?<!-- auto:end -->/g, '')
    .trim();
}

export function enforceMaxBytes(content: string, maxBytes: number): string {
  const contentBytes = Buffer.byteLength(content, 'utf-8');
  if (contentBytes <= maxBytes) {
    return content;
  }

  const sections = content.split(/^### /m).filter(Boolean);
    const namedSections = sections.map((s) => {
    const lines = s.split('\n');
    const name = lines[0]!;
    const body = lines.slice(1).join('\n');
    return { name, body, full: `### ${s}` };
  });

  let result = '';
  for (const section of namedSections) {
    if (Buffer.byteLength(result + section.full + '\n', 'utf-8') <= maxBytes) {
      result += (result ? '\n' : '') + section.full;
    }
  }

  return result;
}

export function mergeAutoBlocks(base: string, incoming: string): string {
  const extractH3Sections = (content: string): Record<string, string> => {
    const sections: Record<string, string> = {};
    const parts = content.split(/^### /m).filter(Boolean);
    for (const part of parts) {
      const lines = part.split('\n');
      const name = lines[0]!;
      const body = lines.slice(1).join('\n').trim();
      sections[name] = body;
    }
    return sections;
  };

  const baseSections = extractH3Sections(base);
  const incomingSections = extractH3Sections(incoming);

  const merged: Record<string, string> = { ...baseSections };
  for (const [name, body] of Object.entries(incomingSections)) {
    merged[name] = body;
  }

  const result = Object.entries(merged)
    .map(([name, body]) => `### ${name}\n${body}`)
    .join('\n\n');

  return result;
}

export function writeMemoryFileAtomic(absPath: string, content: string): void {
  const dir = path.dirname(absPath);
  fs.mkdirSync(dir, { recursive: true });

  const tmpFile = absPath + '.tmp';
  fs.writeFileSync(tmpFile, content, 'utf-8');
  fs.renameSync(tmpFile, absPath);
}
