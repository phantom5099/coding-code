import { Context } from 'effect';
import type { LLMClient } from '../contracts/provider.js';

export interface MemoryShape {
  getMemoryEnabled(): boolean;
  setMemoryEnabled(v: boolean): void;
  loadMemoryForPrompt(cwd: string): string;
  flushSessionToMemory(sessionId: string, llm: LLMClient | null, sessionCwd: string): Promise<{ written: boolean; bytes: number }>;
}

export class MemoryService extends Context.Tag('Memory')<MemoryService, MemoryShape>() {}
