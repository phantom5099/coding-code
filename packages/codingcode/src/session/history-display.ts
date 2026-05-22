import { loadAllRawEvents } from './jsonl-reader.js';
import type { SessionEvent } from './types.js';

export function loadHistoryForDisplay(sessionId: string): SessionEvent[] {
  return loadAllRawEvents(sessionId);
}
