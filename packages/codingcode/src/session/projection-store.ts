import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ProjectionEntry, ProjectionStore } from '../context/projection/types.js';

function sessionDir(sessionId: string): string {
  const dir = join(homedir(), '.codingcode', 'sessions');
  if (!existsSync(dir)) throw new Error('.codingcode/sessions not found');
  for (const slug of readdirSync(dir)) {
    const projectDir = join(dir, slug);
    if (existsSync(join(projectDir, `${sessionId}.jsonl`))) return projectDir;
  }
  throw new Error(`Session ${sessionId} not found`);
}

function projectionsPath(sessionId: string): string {
  return join(sessionDir(sessionId), `${sessionId}.projections.json`);
}

function atomicWriteJson(path: string, obj: unknown): void {
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  try { unlinkSync(path); } catch { /* may not exist */ }
  renameSync(tmp, path);
}

export function emptyStore(sessionId: string): ProjectionStore {
  return { sessionId, version: 2, projections: [] };
}

export function loadProjectionStore(sessionId: string): ProjectionStore {
  const path = projectionsPath(sessionId);
  if (!existsSync(path)) return emptyStore(sessionId);
  try {
    const store = JSON.parse(readFileSync(path, 'utf8')) as ProjectionStore;
    return { ...store, sessionId };
  } catch {
    return emptyStore(sessionId);
  }
}

export function saveProjectionStore(sessionId: string, store: ProjectionStore): void {
  atomicWriteJson(projectionsPath(sessionId), { ...store, sessionId, version: 2 });
}

export function appendProjection(
  sessionId: string,
  entry: ProjectionEntry,
  existingRanges?: Array<[number, number]>,
): void {
  const store = loadProjectionStore(sessionId);

  // Validate non-overlap
  if (entry.type === 'range') {
    const [newStart, newEnd] = entry.turnRange;
    const ranges = existingRanges ?? computeRanges(store.projections);
    for (const [rs, re] of ranges) {
      if (newStart <= re && newEnd >= rs) {
        throw new Error(`RangeProjection [${newStart},${newEnd}] overlaps existing [${rs},${re}]`);
      }
    }
    // Remove any MessageProjections that fall within the new range
    store.projections = store.projections.filter((p) => {
      if (p.type === 'message' && p.originalTurnId >= newStart && p.originalTurnId <= newEnd) return false;
      return true;
    });
  }

  store.projections.push(entry);
  saveProjectionStore(sessionId, store);
}

export function rewindProjections(sessionId: string, turnId: number): void {
  const store = loadProjectionStore(sessionId);
  store.projections = store.projections.filter((p) => {
    if (p.type === 'range') return p.turnRange[1] <= turnId;
    return p.originalTurnId <= turnId;
  });
  saveProjectionStore(sessionId, store);
}

export function computeRanges(projections: ProjectionEntry[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const p of projections) {
    if (p.type === 'range') ranges.push(p.turnRange);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  // Merge overlapping/adjacent ranges
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && last[1] >= r[0]) {
      last[1] = Math.max(last[1], r[1]);
    } else {
      merged.push([...r]);
    }
  }
  return merged;
}
