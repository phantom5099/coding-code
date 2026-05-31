import { describe, it, expect } from 'vitest';
import { assemblePayload } from '../../src/context/organizer.js';

describe('assemblePayload', () => {
  it('is importable and exists as a function', () => {
    expect(typeof assemblePayload).toBe('function');
  });
});
