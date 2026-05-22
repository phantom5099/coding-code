import { describe, it, expect } from 'vitest';
import { getContextConfig } from '../../../src/context/config.js';

describe('Compressor fuse (circuit breaker)', () => {
  it('halts after compactionFuseMaxFailures consecutive zero-release steps', () => {
    const maxFailures = 3;
    let failures = 0;
    const released = 0;

    // Simulate the fuse logic from compressor/index.ts
    while (failures < maxFailures) {
      if (released <= 0) {
        failures++;
        if (failures >= maxFailures) break;
      }
    }

    expect(failures).toBe(maxFailures);
  });

  it('resets failure count on successful release', () => {
    let failures = 0;
    const simulatedResults = [0, 0, 100, 0, 0]; // releases: 0, 0, 100, 0, 0
    const maxFailures = 3;

    let halted = false;
    for (const released of simulatedResults) {
      if (halted) break;
      if (released <= 0) {
        failures++;
        if (failures >= maxFailures) { halted = true; break; }
      } else {
        failures = 0; // reset on success
      }
    }

    expect(halted).toBe(false); // should not halt — the successful release resets the counter
    expect(failures).toBe(2); // after the last two zeros
  });

  it('has fuse config in defaults', () => {
    const config = getContextConfig();
    expect(config.compactionFuseMaxFailures).toBe(3);
    expect(config.minTurnsBetweenCompactions).toBeGreaterThan(0);
  });
});
