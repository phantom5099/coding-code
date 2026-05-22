import type { Message } from '../../core/types.js';

export interface EnrichedMessage {
  message: Message;
  turnId: number;
  uuid: string;
  source:
    | { kind: 'raw'; eventUuid: string }
    | { kind: 'projection'; projectionId: string };
}

export interface RangeProjection {
  type: 'range';
  id: string;
  turnRange: [number, number];
  summaryMessages: Message[];
  method: 'auto-compact' | 'context-collapse' | 'manual';
  createdAt: string;
}

export interface MessageProjection {
  type: 'message';
  id: string;
  targetEventUuid: string;
  replacement: Message;
  originalTurnId: number;
  method: 'prune' | 'collapse-rule' | 'collapse-llm';
  createdAt: string;
}

export type ProjectionEntry = RangeProjection | MessageProjection;

export interface ProjectionStore {
  sessionId: string;
  version: number;
  projections: ProjectionEntry[];
}
