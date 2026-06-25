import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('desktop core-api uses clients.* not raw api() for the 5 settings/session calls', () => {
  it('getMemoryConfig delegates to clients.settings.getMemoryConfig', () => {
    const src = readFileSync(
      'C:/Users/10116/Desktop/agent/coding code/packages/desktop/src/lib/core-api.ts',
      'utf8'
    );
    expect(src).toMatch(/function getMemoryConfig[\s\S]*return clients\.settings\.getMemoryConfig\(\)/);
  });

  it('setMemoryModel delegates to clients.settings.setMemoryModel', () => {
    const src = readFileSync(
      'C:/Users/10116/Desktop/agent/coding code/packages/desktop/src/lib/core-api.ts',
      'utf8'
    );
    expect(src).toMatch(/function setMemoryModel[\s\S]*return clients\.settings\.setMemoryModel/);
  });

  it('getAgentConfig delegates to clients.settings.getAgentConfig', () => {
    const src = readFileSync(
      'C:/Users/10116/Desktop/agent/coding code/packages/desktop/src/lib/core-api.ts',
      'utf8'
    );
    expect(src).toMatch(/function getAgentConfig[\s\S]*return clients\.settings\.getAgentConfig/);
  });

  it('setCompactionModel delegates to clients.settings.setCompactionModel', () => {
    const src = readFileSync(
      'C:/Users/10116/Desktop/agent/coding code/packages/desktop/src/lib/core-api.ts',
      'utf8'
    );
    expect(src).toMatch(/function setCompactionModel[\s\S]*return clients\.settings\.setCompactionModel/);
  });

  it('getSessionPlan delegates to clients.sessions.getSessionPlan', () => {
    const src = readFileSync(
      'C:/Users/10116/Desktop/agent/coding code/packages/desktop/src/lib/core-api.ts',
      'utf8'
    );
    expect(src).toMatch(/function getSessionPlan[\s\S]*return clients\.sessions\.getSessionPlan/);
  });
});
