import type { Message } from '../core/types.js';
import type { SessionEvent } from '../session/types.js';

export interface BuildResult {
  messages: Message[];
  compactedEvents: SessionEvent[];
  promptEstimate: number;
  currentTurnId: number;
  compactedTurnIds: Set<number>;
}

export interface CompressResult {
  didCompress: boolean;
  released: number;
  promptEstimate: number;
}
