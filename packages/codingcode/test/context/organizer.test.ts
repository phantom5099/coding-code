import { describe, it, expect } from 'vitest';
import { assemblePayload } from '../../src/context/organizer.js';
import type { SessionEvent, ToolResultEvent } from '../../src/session/types.js';

const baseConfig = {
  microCompactThreshold: 0.5,
  microCompactMinChars: 120,
  compactionThreshold: 0.9,
  keepRecentTurns: 1,
  compactionModel: '',
  reactiveCompactMaxRetries: 3,
};

function makeUserEvent(content: string, turnId: number): SessionEvent {
  return { type: 'user', uuid: `u${turnId}`, content, turnId, timestamp: new Date().toISOString() };
}

function makeAssistant(content: string, turnId: number): SessionEvent {
  return {
    type: 'assistant',
    uuid: `a${turnId}`,
    content,
    turnId,
    toolCalls: [],
    model: 'test',
    timestamp: new Date().toISOString(),
  };
}

function makeToolResult(
  toolName: string,
  output: string,
  turnId: number,
  uuid: string
): ToolResultEvent {
  return {
    type: 'tool_result',
    uuid,
    parentUuid: 'a1',
    toolName,
    toolCallId: `tc${uuid}`,
    output,
    turnId,
    timestamp: new Date().toISOString(),
    tokenCount: 0,
  };
}

describe('assemblePayload', () => {
  it('is importable and exists as a function', () => {
    expect(typeof assemblePayload).toBe('function');
  });
});
