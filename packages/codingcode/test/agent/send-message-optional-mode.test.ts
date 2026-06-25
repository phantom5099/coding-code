import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('sendMessage options are optional with guard', () => {
  it('agent.ts sendMessage options make mode/permissionMode/model optional', () => {
    const src = readFileSync(
      'C:/Users/10116/Desktop/agent/coding code/packages/codingcode/src/agent/agent.ts',
      'utf8'
    );
    expect(src).toMatch(/mode\?:\s*SessionMode/);
    expect(src).toMatch(/permissionMode\?:\s*PermissionMode/);
    expect(src).toMatch(/model\?:\s*string/);
  });

  it('agent.ts guards new-session branch against missing mode/permissionMode/model', () => {
    const src = readFileSync(
      'C:/Users/10116/Desktop/agent/coding code/packages/codingcode/src/agent/agent.ts',
      'utf8'
    );
    expect(src).toMatch(/SESSION_CONFIG_REQUIRED|new session requires mode/);
  });

  it('messages.ts conditionally builds options (no hardcoded mode on existing-session path)', () => {
    const src = readFileSync(
      'C:/Users/10116/Desktop/agent/coding code/packages/codingcode/src/server/routes/messages.ts',
      'utf8'
    );
    expect(src).toMatch(/isNew\s*=/);
    expect(src).toMatch(/if\s*\(isNew\)/);
  });

  it('direct agent-runtime.ts sends options only on new session', () => {
    const src = readFileSync(
      'C:/Users/10116/Desktop/agent/coding code/packages/codingcode/src/direct/agent-runtime.ts',
      'utf8'
    );
    expect(src).toMatch(/if\s*\(!sessionId\)/);
  });

  it('http agent-runtime.ts sendMessage (sub-client used by desktop) sends options only on new session', () => {
    const src = readFileSync(
      'C:/Users/10116/Desktop/agent/coding code/packages/codingcode/src/client/http/agent-runtime.ts',
      'utf8'
    );
    expect(src).toMatch(/sendMessage\(input,/);
  });
});
