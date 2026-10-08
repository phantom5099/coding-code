import { Context } from 'effect';
import type { Effect } from 'effect';

export interface MemoryShape {
  getMemoryEnabled(): Effect.Effect<boolean>;
  setMemoryEnabled(v: boolean): Effect.Effect<void>;
  loadMemoryForPrompt(cwd: string): Effect.Effect<string>;
  flushSessionToMemory(
    sessionId: string,
    model: string,
    sessionCwd: string
  ): Effect.Effect<{ written: boolean; bytes: number }>;
}

export class MemoryService extends Context.Tag('Memory')<MemoryService, MemoryShape>() {}
