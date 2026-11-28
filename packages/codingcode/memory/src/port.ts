import { Context } from 'effect';
import type { Effect } from 'effect';
import type { SessionKey } from '@codingcode/session';
import type { MemoryConfig } from '@codingcode/infra';

export interface MemoryFlushResult {
  readonly written: boolean;
  readonly bytes: number;
}

export interface FlushSessionMemoryCommand {
  readonly session: SessionKey;
  readonly model: string;
}

export interface MemoryShape {
  getConfig(): Effect.Effect<MemoryConfig>;
  getMemoryEnabled(): Effect.Effect<boolean>;
  setMemoryEnabled(enabled: boolean): Effect.Effect<void>;
  setMemoryModel(model: string): Effect.Effect<void>;
  loadMemoryForPrompt(cwd: string): Effect.Effect<string>;
  flushSessionToMemory(cmd: FlushSessionMemoryCommand): Effect.Effect<MemoryFlushResult>;
}

export class MemoryService extends Context.Tag('Memory')<MemoryService, MemoryShape>() {}
