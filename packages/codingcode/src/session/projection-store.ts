import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ProjectionEntry, ProjectionStore } from '../context/projection/types.js';
import type { SessionIndex, SessionEvent } from './types.js';
import { computeUncoveredOffset, loadAllRawEvents } from './jsonl-reader.js';
import { estimateTokensForContent } from '../context/utils/tokens.js';

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
): void {
  const store = loadProjectionStore(sessionId);

  // Validate non-overlap against raw ranges (not merged)
  if (entry.type === 'range') {
    const [newStart, newEnd] = entry.turnRange;
    for (const p of store.projections) {
      if (p.type !== 'range') continue;
      const [rs, re] = p.turnRange;
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

  // Compute token delta BEFORE appending so we can subtract the displaced
  // raw content (and any displaced MessageProjections in case of Range).
  const tokenDelta = computeTokenDelta(sessionId, entry, store.projections);

  store.projections.push(entry);
  saveProjectionStore(sessionId, store);
  recalcIndexAfterProjection(sessionId, store, tokenDelta);
}

/**
 * Compute how much the index.tokenCountEstimate should change after writing
 * `entry`. Negative = saved tokens.
 *
 * For MessageProjection: replacement tokens - raw event tokens.
 * For RangeProjection:   summary tokens - sum(raw event tokens in range)
 *                        (note: MessageProjections that get displaced were
 *                         already counted as their replacement; we recover
 *                         their displaced replacements by subtracting them
 *                         from currentProjections vs after-filter).
 */
function computeTokenDelta(
  sessionId: string,
  entry: ProjectionEntry,
  remainingProjectionsAfterFilter: ProjectionEntry[],
): number {
  const events = loadAllRawEvents(sessionId);
  const eventByUuid = new Map<string, SessionEvent>();
  for (const e of events) {
    if ('uuid' in e) eventByUuid.set(e.uuid, e);
  }

  const eventTokens = (uuid: string): number => {
    const ev = eventByUuid.get(uuid);
    if (!ev) return 0;
    if (ev.type === 'tool_result') return ev.tokenCount;
    if (ev.type === 'user' || ev.type === 'assistant') return estimateTokensForContent(ev.content);
    return 0;
  };

  if (entry.type === 'message') {
    const before = eventTokens(entry.targetEventUuid);
    const after = estimateTokensForContent(entry.replacement.content);
    return after - before;
  }

  // RangeProjection: subtract all raw events in the range, then add summary.
  // But raw tools that already had a MessageProjection were counted as their
  // replacement, not their raw value. We need to undo that.
  const [start, end] = entry.turnRange;
  let rawSum = 0;
  for (const ev of events) {
    if (!('turnId' in ev)) continue;
    if (ev.turnId < start || ev.turnId > end) continue;
    if (ev.type === 'tool_result') rawSum += ev.tokenCount;
    else if (ev.type === 'user' || ev.type === 'assistant') rawSum += estimateTokensForContent(ev.content);
  }

  // Adjust: if a MessageProjection in the range was previously contributing
  // its (smaller) replacement tokens, we removed those by filtering the store.
  // The current `remainingProjectionsAfterFilter` already excludes them.
  // The displaced MessageProjections previously made the index smaller by
  // (rawTokens - replacementTokens) — to "undo" that contribution, we must
  // add back (rawTokens - replacementTokens) before subtracting rawSum.
  const storeBeforeFilter = loadProjectionStore(sessionId).projections;
  const displaced: ProjectionEntry[] = [];
  for (const p of storeBeforeFilter) {
    if (p.type !== 'message') continue;
    if (p.originalTurnId >= start && p.originalTurnId <= end) displaced.push(p);
  }
  let displacedAdjustment = 0;
  for (const p of displaced) {
    if (p.type !== 'message') continue;
    const rawT = eventTokens(p.targetEventUuid);
    const replT = estimateTokensForContent(p.replacement.content);
    displacedAdjustment += rawT - replT; // restore raw before subtracting rawSum
  }

  const summaryTokens = entry.summaryMessages.reduce(
    (s, m) => s + estimateTokensForContent(m.content), 0,
  );
  return -rawSum + summaryTokens + displacedAdjustment;
}

function sessionIndexPath(sessionId: string): string {
  return join(sessionDir(sessionId), `${sessionId}.index.json`);
}

function sessionTranscriptPath(sessionId: string): string {
  return join(sessionDir(sessionId), `${sessionId}.jsonl`);
}

function recalcIndexAfterProjection(
  sessionId: string,
  store: ProjectionStore,
  tokenDelta: number = 0,
): void {
  const idxPath = sessionIndexPath(sessionId);
  if (!existsSync(idxPath)) return;
  let index: SessionIndex;
  try {
    index = JSON.parse(readFileSync(idxPath, 'utf8')) as SessionIndex;
  } catch {
    return;
  }
  const ranges = computeRanges(store.projections);
  index.projectedRanges = ranges;
  index.projectionCount = store.projections.length;
  index.lastProjectionAt = new Date().toISOString();
  index.lastUncoveredByteOffset = computeUncoveredOffset(sessionTranscriptPath(sessionId), ranges);
  index.tokenCountEstimate = Math.max(0, (index.tokenCountEstimate ?? 0) + tokenDelta);
  atomicWriteJson(idxPath, index);
}

export function rewindProjections(sessionId: string, turnId: number): void {
  const store = loadProjectionStore(sessionId);
  store.projections = store.projections.filter((p) => {
    if (p.type === 'range') return p.turnRange[1] <= turnId;
    return p.originalTurnId <= turnId;
  });
  saveProjectionStore(sessionId, store);
  recalcIndexAfterProjection(sessionId, store);
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
